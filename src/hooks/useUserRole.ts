import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "employee" | "backend_admin";

export function useUserRole(userId: string | undefined) {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setRole(null);
      setLoading(false);
      return;
    }

    const fetchRole = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();

      if (error || !data) {
        console.error("Error fetching user role:", error);
        setRole(null);
      } else {
        setRole(data.role as AppRole);
      }
      setLoading(false);
    };

    fetchRole();
  }, [userId]);

  const isAdmin = role === "admin";
  const isEmployee = role === "employee";
  const isBackendAdmin = role === "backend_admin";

  return { role, isAdmin, isEmployee, isBackendAdmin, loading };
}
