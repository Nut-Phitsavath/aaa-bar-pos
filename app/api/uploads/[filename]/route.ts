import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'

export async function GET(
    request: Request,
    { params }: { params: Promise<{ filename: string }> }
) {
    try {
        const { filename } = await params
        const uploadDir = path.join(process.cwd(), 'public', 'uploads')

        // path.join happily walks out of the directory. Next decodes the URL
        // segment before we see it, so "..%5C..%5Cdev.db" arrived here as a real
        // relative path and this route served the entire database. Resolve
        // first, then refuse anything that did not stay inside uploads.
        const filepath = path.resolve(uploadDir, filename)
        if (filepath !== uploadDir && !filepath.startsWith(uploadDir + path.sep)) {
            console.error('Blocked path traversal attempt:', filename)
            return new NextResponse('File not found', { status: 404 })
        }

        if (!existsSync(filepath)) {
            console.error(`File not found: ${filepath}`)
            return new NextResponse('File not found', { status: 404 })
        }

        const fileBuffer = await readFile(filepath)
        
        // Determine content type based on extension
        const ext = path.extname(filename).toLowerCase()
        const contentTypeMap: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            // No .svg: served as image/svg+xml it can carry script, and nothing
            // writes one any more -- uploads are re-encoded to jpg/png.
            '.webp': 'image/webp'
        }
        
        const contentType = contentTypeMap[ext] || 'application/octet-stream'

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000, immutable'
            }
        })
    } catch (error) {
        console.error('Error serving file:', error)
        return new NextResponse('Internal Server Error', { status: 500 })
    }
}
