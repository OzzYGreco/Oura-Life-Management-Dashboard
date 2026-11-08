// Arete's notifier: a tiny background app (no Dock icon) that posts native
// macOS notifications with the Arete icon. The server launches it with
//   open -g -a Arete.app --args --title T --body B [--subtitle S] [--url U] [--id K] [--sound Glass]
// Clicking a notification relaunches it with no arguments; it opens the URL
// stored on that notification and quits. `--check` prints the permission state.
import AppKit
import UserNotifications

final class Delegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  let center = UNUserNotificationCenter.current()
  var args: [String: String] = [:]
  var flags: Set<String> = []

  func applicationDidFinishLaunching(_ note: Notification) {
    center.delegate = self
    var it = CommandLine.arguments.dropFirst().makeIterator()
    while let a = it.next() {
      guard a.hasPrefix("--") else { continue }
      let k = String(a.dropFirst(2))
      if ["check", "request"].contains(k) { flags.insert(k) } else if let v = it.next() { args[k] = v }
    }
    if flags.contains("check") {
      center.getNotificationSettings { s in
        let state: String
        switch s.authorizationStatus {
        case .authorized: state = "authorized"
        case .denied: state = "denied"
        case .provisional: state = "provisional"
        case .notDetermined: state = "not-determined"
        default: state = "unknown"
        }
        let style = s.alertStyle == .alert ? "alerts" : s.alertStyle == .banner ? "banners" : "none"
        print("\(state) \(style) sound:\(s.soundSetting == .enabled ? "on" : "off")")
        exit(0)
      }
      return
    }
    // No title: launched by a click (the delegate below handles it) or by hand. Quit if nothing arrives.
    guard let title = args["title"] else {
      if flags.contains("request") { authorize { _ in exit(0) } }
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) { exit(0) }
      return
    }
    authorize { ok in
      guard ok else { exit(2) }
      let c = UNMutableNotificationContent()
      c.title = title
      if let s = self.args["subtitle"] { c.subtitle = s }
      c.body = self.args["body"] ?? ""
      if let u = self.args["url"] { c.userInfo = ["url": u] }
      c.sound = self.sound(self.args["sound"])
      c.interruptionLevel = .active
      let req = UNNotificationRequest(identifier: self.args["id"] ?? UUID().uuidString, content: c, trigger: nil)
      self.center.add(req) { err in
        if let err { FileHandle.standardError.write("\(err.localizedDescription)\n".data(using: .utf8)!) }
        // Stay alive briefly so the system takes the notification before the app quits.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { exit(err == nil ? 0 : 1) }
      }
    }
  }

  func authorize(_ done: @escaping (Bool) -> Void) {
    center.requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in DispatchQueue.main.async { done(ok) } }
  }

  /// A system sound by name (Glass, Ping, Hero…), copied into ~/Library/Sounds once so the notification can use it.
  func sound(_ name: String?) -> UNNotificationSound {
    guard let name, !name.isEmpty, name != "default" else { return .default }
    let fm = FileManager.default
    let lib = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Sounds")
    let dest = lib.appendingPathComponent("\(name).aiff")
    if !fm.fileExists(atPath: dest.path) {
      let src = URL(fileURLWithPath: "/System/Library/Sounds/\(name).aiff")
      guard fm.fileExists(atPath: src.path) else { return .default }
      try? fm.createDirectory(at: lib, withIntermediateDirectories: true)
      try? fm.copyItem(at: src, to: dest)
    }
    return UNNotificationSound(named: UNNotificationSoundName("\(name).aiff"))
  }

  // Show it even if this app happens to be frontmost.
  func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .list, .sound])
  }

  // A click: open the page it points at, then quit.
  func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    if let s = r.notification.request.content.userInfo["url"] as? String, let u = URL(string: s) { NSWorkspace.shared.open(u) }
    done()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
  }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
