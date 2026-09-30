// Minimal Electron asar reader.
//   node asar.mjs list  <asar> [prefix]        -> print entry paths
//   node asar.mjs cat   <asar> <inner-path>    -> write file bytes to stdout
//   node asar.mjs get   <asar> <inner> <out>   -> extract one entry to <out>
//   node asar.mjs dump  <asar> <prefix> <dir>  -> extract a whole subtree
import { openSync, readSync, closeSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

function readHeader(path) {
  const fd = openSync(path, 'r')
  try {
    const sizeBuf = Buffer.alloc(8)
    readSync(fd, sizeBuf, 0, 8, 0)
    const size = sizeBuf.readUInt32LE(4)
    const headerBuf = Buffer.alloc(size)
    readSync(fd, headerBuf, 0, size, 8)
    const strLen = headerBuf.readUInt32LE(4)
    const json = headerBuf.subarray(8, 8 + strLen).toString('utf8')
    return { header: JSON.parse(json), dataOffset: 8 + size, fd }
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

function walk(node, prefix, out) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (child.files !== undefined) walk(child, path, out)
    else out.push({ path, size: child.size, offset: child.offset, unpacked: child.unpacked === true })
  }
}

const [, , command, asarPath, ...rest] = process.argv
const { header, dataOffset, fd } = readHeader(asarPath)
const entries = []
walk(header, '', entries)
const keepOpen = ['cat', 'get', 'dump', 'pkgs'].includes(command)
if (!keepOpen) closeSync(fd)

if (command === 'list') {
  const prefix = rest[0] ?? ''
  for (const entry of entries) if (entry.path.startsWith(prefix)) console.log(`${entry.unpacked ? 'u' : ' '} ${String(entry.size).padStart(10)} ${entry.path}`)
} else if (command === 'cat') {
  const target = entries.find((entry) => entry.path === rest[0])
  if (target === undefined) { console.error(`not found: ${rest[0]}`); process.exit(2) }
  if (target.unpacked) { process.stdout.write(readFileSync(join(`${asarPath}.unpacked`, target.path))); process.exit(0) }
  const buffer = Buffer.alloc(target.size)
  readSync(fd, buffer, 0, target.size, dataOffset + Number(target.offset))
  process.stdout.write(buffer)
  closeSync(fd)
} else if (command === 'get') {
  const target = entries.find((entry) => entry.path === rest[0])
  if (target === undefined) { console.error(`not found: ${rest[0]}`); process.exit(2) }
  const out = rest[1]
  mkdirSync(dirname(out), { recursive: true })
  if (target.unpacked) { writeFileSync(out, readFileSync(join(`${asarPath}.unpacked`, target.path))); process.exit(0) }
  const buffer = Buffer.alloc(target.size)
  readSync(fd, buffer, 0, target.size, dataOffset + Number(target.offset))
  writeFileSync(out, buffer)
  closeSync(fd)
} else if (command === 'dump') {
  const [prefix, outDir] = rest
  let count = 0
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue
    const out = join(outDir, entry.path)
    mkdirSync(dirname(out), { recursive: true })
    if (entry.unpacked) { writeFileSync(out, readFileSync(join(`${asarPath}.unpacked`, entry.path))); count++; continue }
    const buffer = Buffer.alloc(entry.size)
    readSync(fd, buffer, 0, entry.size, dataOffset + Number(entry.offset))
    writeFileSync(out, buffer)
    count++
  }
  closeSync(fd)
  console.log(`extracted ${count} entries under ${prefix} -> ${outDir}`)
} else if (command === 'pkgs') {
  const prefix = rest[0] ?? ''
  for (const entry of entries) {
    if (!entry.path.endsWith('/package.json') || !entry.path.startsWith(prefix)) continue
    let buffer
    if (entry.unpacked) buffer = readFileSync(join(`${asarPath}.unpacked`, entry.path))
    else {
      buffer = Buffer.alloc(entry.size)
      readSync(fd, buffer, 0, entry.size, dataOffset + Number(entry.offset))
    }
    try {
      const pkg = JSON.parse(buffer.toString('utf8'))
      console.log(`${pkg.version}\t${pkg.name}\t${entry.path}`)
    } catch { /* not a manifest */ }
  }
  closeSync(fd)
} else {
  console.error('usage: asar.mjs list|cat|get|dump|pkgs ...')
  process.exit(1)
}
