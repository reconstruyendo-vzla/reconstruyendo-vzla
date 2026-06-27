import sharp from 'sharp'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceSvg = readFileSync(join(root, 'public/Reconstruyendo-full.svg'))

const sizes = [
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
  { file: 'src/app/icon.png', size: 32 },
  { file: 'src/app/apple-icon.png', size: 180 },
  { file: 'public/favicon.ico', size: 32 },
]

mkdirSync(join(root, 'src/app'), { recursive: true })

for (const { file, size } of sizes) {
  const out = join(root, file)
  const padding = Math.round(size * 0.14)
  const inner = size - padding * 2

  const png = await sharp(sourceSvg)
    .resize(inner, inner, { fit: 'contain', background: '#ffffff' })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: '#ffffff',
    })
    .png()
    .toBuffer()

  writeFileSync(out, png)
  console.log(`Generated ${file} (${size}x${size})`)
}
