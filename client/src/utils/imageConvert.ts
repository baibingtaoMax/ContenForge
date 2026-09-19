// 图片格式转换：纯浏览器本地转换，文件不出机器
// JPG/PNG/WebP 走 canvas 原生编码；BMP/ICO 手写编码器保证跨浏览器一致

export type OutFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'ico'

export interface LoadedImage {
  bitmap: ImageBitmap | HTMLImageElement
  width: number
  height: number
  /** HEIC 解码后实际类型；仅用于提示 */
  decodedFromHeic: boolean
}

const MIME: Record<OutFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

export function outMime(f: OutFormat): string {
  return MIME[f]
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 替换/追加扩展名 */
export function replaceExt(name: string, ext: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return `${base}.${ext}`
}

export function isHeic(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name) || /image\/hei(c|f)/i.test(file.type)
}

/** 加载图片；HEIC/HEIF 先懒加载 heic2any 解成 PNG */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  let blob: Blob = file
  let decodedFromHeic = false
  if (isHeic(file)) {
    const mod = await import('heic2any')
    const heic2any = mod.default
    const out = await heic2any({ blob, toType: 'image/png', quality: 0.95 })
    blob = Array.isArray(out) ? out[0] : out
    decodedFromHeic = true
  }
  // createImageBitmap 能顺带处理手机照片 EXIF 方向；不支持时回退 <img>
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    return { bitmap: bmp, width: bmp.width, height: bmp.height, decodedFromHeic }
  } catch {
    const url = URL.createObjectURL(blob)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image()
        im.onload = () => resolve(im)
        im.onerror = () => reject(new Error('图片加载失败'))
        im.src = url
      })
      return { bitmap: img, width: img.naturalWidth, height: img.naturalHeight, decodedFromHeic }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/** 把图画到 canvas；jpeg/bmp 无透明通道，补白底 */
function drawToCanvas(img: LoadedImage, w: number, h: number, whiteBg: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  if (whiteBg) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
  }
  ctx.drawImage(img.bitmap, 0, 0, w, h)
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('编码失败'))),
      type,
      quality
    )
  })
}

// ---------- BMP（24 位，bottom-up，行 4 字节对齐） ----------

function encodeBmp(canvas: HTMLCanvasElement): Blob {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, w, h)
  const rowSize = Math.floor((24 * w + 31) / 32) * 4
  const pixelBytes = rowSize * h
  const fileSize = 14 + 40 + pixelBytes
  const buf = new ArrayBuffer(fileSize)
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)

  // BITMAPFILEHEADER
  dv.setUint16(0, 0x4d42, true) // 'BM'
  dv.setUint32(2, fileSize, true)
  dv.setUint32(6, 0, true)
  dv.setUint32(10, 14 + 40, true) // 像素数据偏移
  // BITMAPINFOHEADER
  dv.setUint32(14, 40, true)
  dv.setInt32(18, w, true)
  dv.setInt32(22, h, true) // 正数 = bottom-up
  dv.setUint16(26, 1, true) // planes
  dv.setUint16(28, 24, true) // bpp
  dv.setUint32(30, 0, true) // BI_RGB
  dv.setUint32(34, pixelBytes, true)
  dv.setUint32(38, 2835, true) // 72 DPI
  dv.setUint32(42, 2835, true)

  let off = 54
  for (let y = h - 1; y >= 0; y--) {
    let rowOff = off
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // 与白底合成（防半透明星点）
      const a = data[i + 3] / 255
      u8[rowOff++] = Math.round(data[i + 2] * a + 255 * (1 - a)) // B
      u8[rowOff++] = Math.round(data[i + 1] * a + 255 * (1 - a)) // G
      u8[rowOff++] = Math.round(data[i] * a + 255 * (1 - a)) // R
    }
    off += rowSize
  }
  return new Blob([buf], { type: 'image/bmp' })
}

// ---------- ICO（内嵌 PNG，多尺寸 16/32/48/...，不放大只缩小） ----------

async function encodeIco(img: LoadedImage): Promise<Blob> {
  const maxDim = Math.max(img.width, img.height)
  const candidates = [16, 32, 48, 64, 128, 256]
  const sizes = candidates.filter((s) => s <= maxDim)
  if (sizes.length === 0) sizes.push(Math.min(16, maxDim))

  const pngs: { size: number; bytes: Uint8Array }[] = []
  for (const s of sizes) {
    const canvas = drawToCanvas(img, s, s, false)
    const blob = await canvasToBlob(canvas, 'image/png')
    pngs.push({ size: s, bytes: new Uint8Array(await blob.arrayBuffer()) })
  }

  const headerSize = 6
  const entrySize = 16
  const dataSize = pngs.reduce((sum, p) => sum + p.bytes.length, 0)
  const total = headerSize + entrySize * pngs.length + dataSize
  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)

  // ICONDIR
  dv.setUint16(0, 0, true)
  dv.setUint16(2, 1, true) // type=icon
  dv.setUint16(4, pngs.length, true)

  let offset = headerSize + entrySize * pngs.length
  pngs.forEach((p, i) => {
    const e = 6 + i * entrySize
    dv.setUint8(e, p.size >= 256 ? 0 : p.size) // width
    dv.setUint8(e + 1, p.size >= 256 ? 0 : p.size) // height
    dv.setUint8(e + 2, 0) // palette
    dv.setUint8(e + 3, 0) // reserved
    dv.setUint16(e + 4, 1, true) // planes
    dv.setUint16(e + 6, 32, true) // bpp
    dv.setUint32(e + 8, p.bytes.length, true)
    dv.setUint32(e + 12, offset, true)
    u8.set(p.bytes, offset)
    offset += p.bytes.length
  })
  return new Blob([buf], { type: 'image/x-icon' })
}

export interface ConvertResult {
  blob: Blob
  url: string
  width: number
  height: number
}

/** 主入口 */
export async function convertImage(
  img: LoadedImage,
  format: OutFormat,
  quality = 0.9
): Promise<ConvertResult> {
  let blob: Blob
  const { width, height } = img

  if (format === 'ico') {
    blob = await encodeIco(img)
  } else if (format === 'bmp') {
    blob = encodeBmp(drawToCanvas(img, width, height, true))
  } else {
    const white = format === 'jpeg'
    const canvas = drawToCanvas(img, width, height, white)
    blob = await canvasToBlob(canvas, MIME[format], quality)
  }
  return { blob, url: URL.createObjectURL(blob), width, height }
}

/** jpg/webp 才显示质量滑块 */
export function supportsQuality(f: OutFormat): boolean {
  return f === 'jpeg' || f === 'webp'
}

export function extOf(f: OutFormat): string {
  return f === 'jpeg' ? 'jpg' : f
}
