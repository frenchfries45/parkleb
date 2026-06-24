import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: callerUser },
      error: callerError,
    } = await callerClient.auth.getUser();

    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("user_id", callerUser.id)
      .maybeSingle();

    const callerRole = callerProfile?.role ?? null;

    if (callerRole !== "admin" && callerRole !== "backend_admin") {
      return new Response(JSON.stringify({ error: "Admin or backend access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { username, password, role } = await req.json();

    if (!username || !password) {
      return new Response(
        JSON.stringify({ error: "Username and password are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!/^[a-zA-Z]{5,10}$/.test(username)) {
      return new Response(
        JSON.stringify({ error: "Username must be 5-10 letters only" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("username", username.toLowerCase())
      .maybeSingle();

    if (existingProfile) {
      return new Response(
        JSON.stringify({ error: "Username already taken" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const generatedEmail = `${username.toLowerCase()}@parkleb.internal`;

    const { data: newUser, error: createError } =
      await adminClient.auth.admin.createUser({
        email: generatedEmail,
        password,
        email_confirm: true,
        user_metadata: { display_name: username },
      });

    if (createError) {
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Set username + role on profile (handle_new_user trigger inserts the row with default 'employee')
    const assignedRole = ["admin", "employee", "backend_admin"].includes(role)
      ? role
      : "employee";

    await adminClient
      .from("profiles")
      .update({ username: username.toLowerCase(), role: assignedRole })
      .eq("user_id", newUser.user.id);

    return new Response(
      JSON.stringify({
        success: true,
        user: { id: newUser.user.id, username: username.toLowerCase(), role: assignedRole },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
