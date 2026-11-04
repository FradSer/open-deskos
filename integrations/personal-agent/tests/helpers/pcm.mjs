export function pcm(frames, sample = 0) {
  const data = Buffer.alloc(frames * 640)
  for (let i = 0; i < data.length; i += 2) data.writeInt16LE(sample, i)
  return data
}
