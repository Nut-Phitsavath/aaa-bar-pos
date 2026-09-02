import { NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import bcrypt from "bcryptjs"

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()

    // Bypassing Supabase for demo credentials
    if (email === "admin@cafe.com" && password === "admin123") {
      const cookieStore = await cookies()
      // Create session
      const response = NextResponse.json({
        user: {
          id: "demo-admin-id",
          email: "admin@cafe.com",
          full_name: "Demo Admin",
          role: "admin",
        },
      })

      // Set session cookie
      response.cookies.set(
        "pos_session",
        JSON.stringify({
          id: "demo-admin-id",
          email: "admin@cafe.com",
          full_name: "Demo Admin",
          role: "ADMIN",
        }),
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 7, // 7 days
        },
      )
      return response
    }

    const cookieStore = await cookies()
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    })

    // Query the staff table for the user
    const { data: staff, error } = await supabase
      .from("staff")
      .select("*")
      .eq("email", email)
      .eq("is_active", true)
      .single()

    if (error || !staff) {
      return NextResponse.json({ error: "Invalid login credentials" }, { status: 401 })
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, staff.password_hash)

    if (!isValidPassword) {
      return NextResponse.json({ error: "Invalid login credentials" }, { status: 401 })
    }

    // Create session
    const response = NextResponse.json({
      user: {
        id: staff.id,
        email: staff.email,
        full_name: staff.full_name,
        role: staff.role,
      },
    })

    // Set session cookie
    response.cookies.set(
      "pos_session",
      JSON.stringify({
        id: staff.id,
        email: staff.email,
        full_name: staff.full_name,
        role: staff.role.toUpperCase(), // Ensure uppercase for consistency
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      },
    )

    return response
  } catch (error) {
    return NextResponse.json({ error: "An error occurred during login" }, { status: 500 })
  }
}
