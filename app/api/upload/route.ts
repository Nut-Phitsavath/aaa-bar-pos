import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { normalizeUploadImage, safeUploadName, MAX_UPLOAD_BYTES } from '@/lib/image'

export async function POST(request: Request) {
    try {
        const formData = await request.formData()
        const file = formData.get('file') as File

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded', code: 'NO_FILE' }, { status: 400 })
        }

        if (file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json({ error: 'Image too large', code: 'TOO_LARGE' }, { status: 413 })
        }

        const raw = Buffer.from(await file.arrayBuffer())

        // Downsize here rather than trusting what the phone produced. Staff send
        // 4000px photos straight from the camera roll; storing those makes the
        // till re-encode megabytes every time next/image needs a new size.
        let normalized
        try {
            normalized = await normalizeUploadImage(raw)
        } catch (e) {
            // sharp refusing the bytes is also the file-type check: whatever this
            // is, it is not an image we can serve.
            console.error('Upload rejected (not a readable image):', e)
            return NextResponse.json({ error: 'Not a readable image', code: 'NOT_IMAGE' }, { status: 400 })
        }

        const filename = safeUploadName(file.name || 'photo', normalized.ext)
        const uploadDir = path.join(process.cwd(), 'public', 'uploads')
        await mkdir(uploadDir, { recursive: true })
        await writeFile(path.join(uploadDir, filename), normalized.buffer)

        return NextResponse.json({
            url: `/api/uploads/${filename}`,
            bytes: normalized.buffer.length,
            originalBytes: raw.length,
        })
    } catch (error) {
        console.error('Upload error:', error)
        return NextResponse.json({ error: 'Upload failed', code: 'FAILED' }, { status: 500 })
    }
}
