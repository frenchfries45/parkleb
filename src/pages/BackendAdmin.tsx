import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { usePendingMessages, PendingMessage } from "@/hooks/usePendingMessages";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Car,
  Phone,
  MessageSquare,
  CheckCircle2,
  Clock,
  LogOut,
  RefreshCw,
  X,
  Users,
  Send,
  UserPlus,
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

// ─── Phone normalization ───────────────────────────────────────────────────────
function normalizePhone(raw: string): string {
  let cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+961")) return cleaned.slice(1);
  if (cleaned.startsWith("961")) return cleaned;
  if (cleaned.startsWith("0")) return "961" + cleaned.slice(1);
  return "961" + cleaned;
}

// ─── Types ─────────────────────────────────────────────────────────────────────
interface BulkGroup {
  messageText: string;
  messages: PendingMessage[];
  requestedBy: string;
  createdAt: Date;
}

interface AppUser {
  userId: string;
  username: string;
  role: string;
}

export default function BackendAdmin() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { role, loading: roleLoading } = useUserRole(user?.id);
  const { messages, loading, markAsSent, refetch } = usePendingMessages();
  const { toast } = useToast();

  // Message queue state
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [markingGroupIdx, setMarkingGroupIdx] = useState<number | null>(null);

  // Current user display
  const [currentUsername, setCurrentUsername] = useState("");

  // User management state
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // Create user form
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"employee" | "admin" | "backend_admin">("employee");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [creating, setCreating] = useState(false);

  // Reset password form
  const [resetTarget, setResetTarget] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { replace: true });
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!roleLoading && role && role !== "backend_admin") {
      navigate("/", { replace: true });
    }
  }, [role, roleLoading, navigate]);

  // Fetch current user's display name
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("username, display_name")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) setCurrentUsername(data.username || data.display_name || "");
      });
  }, [user]);

  // Fetch all app users
  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, username, display_name");

    if (error || !data) {
      setUsersLoading(false);
      return;
    }

    // Fetch roles for all users
    const userIds = data.map((p) => p.user_id);
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", userIds);

    const roleMap: Record<string, string> = {};
    for (const r of roles || []) roleMap[r.user_id] = r.role;

    setAppUsers(
      data
        .filter((p) => p.username)
        .map((p) => ({
          userId: p.user_id,
          username: p.username!,
          role: roleMap[p.user_id] || "employee",
        }))
        .sort((a, b) => a.username.localeCompare(b.username))
    );
    setUsersLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ── Message queue handlers ──────────────────────────────────────────────────

  const handleMarkSent = async (msg: PendingMessage) => {
    setMarkingId(msg.id);
    const ok = await markAsSent(msg.id, currentUsername || "backend_admin");
    if (ok) toast({ title: "Marked as Sent", description: `Message for ${msg.subscriberName} marked as sent.` });
    setMarkingId(null);
  };

  const handleDismiss = async (msg: PendingMessage) => {
    setDismissingId(msg.id);
    const { error } = await supabase.from("pending_messages").delete().eq("id", msg.id);
    if (error) {
      toast({ title: "Error", description: "Could not dismiss the message.", variant: "destructive" });
    } else {
      toast({ title: "Dismissed", description: `Request for ${msg.subscriberName} removed.` });
      refetch();
    }
    setDismissingId(null);
  };

  const handleSendSMS = (msg: PendingMessage) => {
    const phone = normalizePhone(msg.subscriberPhone);
    const text = encodeURIComponent(msg.message);
    window.open(
      `https://gw3s.broadnet.me:8443/websmpp/websms?user=TapTap&pass=Ab3$kL9x&sid=ParkLEB&mno=${phone}&type=1&text=${text}`,
      "_blank"
    );
  };

  // ── Bulk tab ────────────────────────────────────────────────────────────────

  const bulkMessages = messages.filter((m) => m.isBulk);
  const bulkGroups: BulkGroup[] = Object.values(
    bulkMessages.reduce<Record<string, BulkGroup>>((acc, msg) => {
      const key = msg.message.trim();
      if (!acc[key]) acc[key] = { messageText: key, messages: [], requestedBy: msg.requestedByUsername, createdAt: msg.createdAt };
      acc[key].messages.push(msg);
      return acc;
    }, {})
  );

  const handleSendBulkGroup = (group: BulkGroup) => {
    const phones = group.messages.map((m) => normalizePhone(m.subscriberPhone)).join(",");
    const text = encodeURIComponent(group.messageText);
    window.open(
      `https://gw3s.broadnet.me:8443/websmpp/websms?user=TapTap&pass=Ab3$kL9x&sid=ParkLEB&mno=${phones}&type=1&text=${text}`,
      "_blank"
    );
  };

  const handleMarkGroupSent = async (group: BulkGroup, idx: number) => {
    setMarkingGroupIdx(idx);
    for (const msg of group.messages) await markAsSent(msg.id, currentUsername || "backend_admin");
    toast({ title: "Group Marked as Sent", description: `${group.messages.length} message(s) marked as sent.` });
    setMarkingGroupIdx(null);
    refetch();
  };

  // ── User management handlers ────────────────────────────────────────────────

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[a-zA-Z]{5,10}$/.test(newUsername)) {
      toast({ title: "Error", description: "Username must be 5-10 letters only.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("create-user", {
      body: { username: newUsername, password: newPassword, role: newRole },
    });
    if (error || data?.error) {
      toast({ title: "Error", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "User Created", description: `@${newUsername} created as ${newRole}.` });
      setNewUsername("");
      setNewPassword("");
      setNewRole("employee");
      fetchUsers();
    }
    setCreating(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) {
      toast({ title: "Error", description: "Select a user first.", variant: "destructive" });
      return;
    }
    if (resetPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    setResetting(true);
    const { data, error } = await supabase.functions.invoke("reset-password", {
      body: { username: resetTarget, new_password: resetPassword },
    });
    if (error || data?.error) {
      toast({ title: "Error", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Password Reset", description: `Password for @${resetTarget} updated.` });
      setResetTarget("");
      setResetPassword("");
    }
    setResetting(false);
  };

  const roleLabel = (r: string) => {
    if (r === "backend_admin") return "Backend";
    if (r === "admin") return "Admin";
    return "Employee";
  };

  const roleBadgeVariant = (r: string): "default" | "secondary" | "outline" => {
    if (r === "backend_admin") return "default";
    if (r === "admin") return "secondary";
    return "outline";
  };

  const queueCount = messages.length;
  const bulkCount = bulkMessages.length;

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary rounded-lg">
              <MessageSquare className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">PARKleb — Backend</h1>
              <p className="text-sm text-muted-foreground">Message queue & user management</p>
            </div>
            {currentUsername && (
              <div className="hidden sm:flex items-center gap-1.5 ms-1 ps-3 border-s border-border">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-primary uppercase">
                    {currentUsername.charAt(0)}
                  </span>
                </div>
                <span className="text-sm font-medium text-foreground capitalize">
                  {currentUsername}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="hidden sm:inline-flex">Backend Admin</Badge>
            <Button variant="outline" size="icon" onClick={refetch} title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={signOut} title="Sign Out">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Tabs defaultValue="queue">
          <TabsList className="mb-6">
            <TabsTrigger value="queue" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              Queue
              {queueCount > 0 && (
                <Badge variant="secondary" className="text-xs h-5 px-1.5">{queueCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="bulk" className="gap-2">
              <Users className="w-4 h-4" />
              Bulk
              {bulkCount > 0 && (
                <Badge variant="secondary" className="text-xs h-5 px-1.5">{bulkCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <ShieldCheck className="w-4 h-4" />
              Users
            </TabsTrigger>
          </TabsList>

          {/* ── Queue Tab ── */}
          <TabsContent value="queue">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2">
                <Clock className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                  {loading ? "..." : queueCount} pending message{queueCount !== 1 ? "s" : ""}
                </span>
              </div>
              <p className="text-sm text-muted-foreground hidden sm:block">
                Send each message, then mark as sent. Dismiss duplicates.
              </p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-20">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground">All clear!</h3>
                <p className="text-muted-foreground mt-1">No pending messages right now.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {messages.map((msg) => (
                  <Card key={msg.id} className="animate-fade-in relative">
                    <button
                      className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      onClick={() => handleDismiss(msg)}
                      disabled={dismissingId === msg.id}
                      title="Dismiss duplicate"
                    >
                      {dismissingId === msg.id ? (
                        <div className="w-4 h-4 animate-spin border-2 border-current border-t-transparent rounded-full" />
                      ) : (
                        <X className="w-4 h-4" />
                      )}
                    </button>
                    <CardHeader className="pb-3 pr-10">
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-base">{msg.subscriberName}</CardTitle>
                        <Badge variant={msg.isBulk ? "secondary" : "outline"} className="text-xs shrink-0 ml-2">
                          {msg.isBulk ? "Bulk" : "Individual"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        By <span className="font-medium">{msg.requestedByUsername}</span>
                        {" · "}{format(msg.createdAt, "MMM d, HH:mm")}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                          <a href={`tel:${msg.subscriberPhone}`} className="font-medium text-primary hover:underline">
                            {msg.subscriberPhone}
                          </a>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Car className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="font-medium">{msg.vehiclePlate}</span>
                        </div>
                      </div>
                      <div className="bg-muted rounded-lg p-3 text-xs leading-relaxed">{msg.message}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => handleSendSMS(msg)}>
                          <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                          Send SMS
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => navigator.clipboard.writeText(msg.message)}>
                          Copy Msg
                        </Button>
                      </div>
                      <Button className="w-full gap-2" size="sm" disabled={markingId === msg.id} onClick={() => handleMarkSent(msg)}>
                        <CheckCircle2 className="w-4 h-4" />
                        {markingId === msg.id ? "Marking..." : "Mark as Sent"}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Bulk Tab ── */}
          <TabsContent value="bulk">
            {bulkGroups.length === 0 ? (
              <div className="text-center py-20">
                <Users className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
                <p className="text-muted-foreground">No bulk messages pending.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {bulkGroups.map((group, idx) => (
                  <Card key={idx}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Users className="w-4 h-4 text-primary" />
                            Bulk Group — {group.messages.length} subscriber{group.messages.length !== 1 ? "s" : ""}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground mt-1">
                            By <span className="font-medium">{group.requestedBy}</span>
                            {" · "}{format(group.createdAt, "MMM d, HH:mm")}
                          </p>
                        </div>
                        <Badge variant="secondary">{group.messages.length} recipients</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Message</p>
                        <div className="bg-muted rounded-lg p-3 text-sm leading-relaxed">{group.messageText}</div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recipients</p>
                        <div className="divide-y divide-border/50 border border-border rounded-lg overflow-hidden">
                          {group.messages.map((msg) => (
                            <div key={msg.id} className="flex items-center justify-between px-3 py-2 text-sm bg-card hover:bg-muted/30 transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="font-medium truncate">{msg.subscriberName}</span>
                                <span className="text-muted-foreground text-xs shrink-0">{msg.vehiclePlate}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-muted-foreground font-mono">{normalizePhone(msg.subscriberPhone)}</span>
                                <button
                                  className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                  onClick={() => handleDismiss(msg)}
                                  disabled={dismissingId === msg.id}
                                  title="Remove this recipient"
                                >
                                  {dismissingId === msg.id ? (
                                    <div className="w-3.5 h-3.5 animate-spin border-2 border-current border-t-transparent rounded-full" />
                                  ) : (
                                    <X className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Formatted numbers for SMS</p>
                        <div className="bg-muted rounded-lg p-3 text-xs font-mono break-all leading-relaxed">
                          {group.messages.map((m) => normalizePhone(m.subscriberPhone)).join(", ")}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <Button className="gap-2" onClick={() => handleSendBulkGroup(group)}>
                          <Send className="w-4 h-4" />
                          Send Bulk SMS
                        </Button>
                        <Button variant="outline" className="gap-2" disabled={markingGroupIdx === idx} onClick={() => handleMarkGroupSent(group, idx)}>
                          <CheckCircle2 className="w-4 h-4" />
                          {markingGroupIdx === idx ? "Marking..." : "Mark All Sent"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Users Tab ── */}
          <TabsContent value="users">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Create User */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-primary" />
                    Create New User
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateUser} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="new-username">Username</Label>
                      <Input
                        id="new-username"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 10))}
                        placeholder="e.g. karim"
                        minLength={5}
                        maxLength={10}
                        required
                        autoComplete="off"
                      />
                      <p className="text-xs text-muted-foreground">5–10 letters only</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-password">Password</Label>
                      <div className="relative">
                        <Input
                          id="new-password"
                          type={showNewPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Min 6 characters"
                          minLength={6}
                          required
                          autoComplete="new-password"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowNewPassword((p) => !p)}
                        >
                          {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Role</Label>
                      <Select value={newRole} onValueChange={(v) => setNewRole(v as any)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="employee">Employee</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="backend_admin">Backend Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="submit" className="w-full gap-2" disabled={creating}>
                      {creating ? (
                        <div className="w-4 h-4 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
                      ) : (
                        <UserPlus className="w-4 h-4" />
                      )}
                      {creating ? "Creating..." : "Create User"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Reset Password */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-primary" />
                    Reset Password
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleResetPassword} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Select User</Label>
                      <Select value={resetTarget} onValueChange={setResetTarget}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a user..." />
                        </SelectTrigger>
                        <SelectContent>
                          {appUsers.map((u) => (
                            <SelectItem key={u.userId} value={u.username}>
                              <span className="capitalize">{u.username}</span>
                              <span className="text-muted-foreground text-xs ml-2">({roleLabel(u.role)})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reset-password">New Password</Label>
                      <div className="relative">
                        <Input
                          id="reset-password"
                          type={showResetPassword ? "text" : "password"}
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                          placeholder="Min 6 characters"
                          minLength={6}
                          required
                          autoComplete="new-password"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowResetPassword((p) => !p)}
                        >
                          {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <Button type="submit" variant="outline" className="w-full gap-2" disabled={resetting}>
                      {resetting ? (
                        <div className="w-4 h-4 animate-spin border-2 border-current border-t-transparent rounded-full" />
                      ) : (
                        <KeyRound className="w-4 h-4" />
                      )}
                      {resetting ? "Resetting..." : "Reset Password"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* All Users List */}
              <Card className="lg:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    All Users
                    <Badge variant="secondary" className="ml-auto">{appUsers.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {usersLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                    </div>
                  ) : appUsers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No users found.</p>
                  ) : (
                    <div className="divide-y divide-border rounded-lg border overflow-hidden">
                      {appUsers.map((u) => (
                        <div key={u.userId} className="flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="text-xs font-semibold text-primary uppercase">{u.username.charAt(0)}</span>
                            </div>
                            <span className="font-medium text-foreground capitalize">{u.username}</span>
                          </div>
                          <Badge variant={roleBadgeVariant(u.role)} className="text-xs">
                            {roleLabel(u.role)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
