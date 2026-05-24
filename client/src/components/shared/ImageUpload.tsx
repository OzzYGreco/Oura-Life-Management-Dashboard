import { useRef, useState, type DragEvent } from 'react'
import { Upload, X } from 'lucide-react'
import { cn } from '../../lib/utils'

interface UploadedImage {
  file?: File
  preview: string
  note?: string
}

interface ImageUploadProps {
  images: UploadedImage[]
  onChange: (images: UploadedImage[]) => void
  label?: string
}

export function ImageUpload({ images, onChange, label }: ImageUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const addFiles = (files: FileList | null) => {
    if (!files) return
    const newImgs: UploadedImage[] = Array.from(files)
      .filter(f => f.type.startsWith('image/'))
      .map(f => ({ file: f, preview: URL.createObjectURL(f), note: '' }))
    onChange([...images, ...newImgs])
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  return (
    <div className="flex flex-col gap-2">
      {label && <label className="text-xs text-text-secondary font-medium uppercase tracking-wide">{label}</label>}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors',
          dragging ? 'border-accent-blue bg-accent-blue/5' : 'border-bg-border hover:border-bg-hover'
        )}
      >
        <Upload size={16} className="mx-auto mb-1 text-text-muted" />
        <span className="text-xs text-text-muted">Drop images or click to upload</span>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative bg-bg-secondary border border-bg-border rounded-lg overflow-hidden group">
              <img src={img.preview} alt="" className="w-full h-32 object-cover" />
              <button
                type="button"
                onClick={() => onChange(images.filter((_, j) => j !== i))}
                className="absolute top-1 right-1 bg-black/60 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={12} className="text-white" />
              </button>
              <input
                type="text"
                value={img.note || ''}
                onChange={e => {
                  const updated = [...images]
                  updated[i] = { ...updated[i], note: e.target.value }
                  onChange(updated)
                }}
                placeholder="Note..."
                className="w-full px-2 py-1 bg-bg-card border-t border-bg-border text-xs text-text-primary placeholder:text-text-muted outline-none"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
