const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

export type Stream = {
  id: string;
  label: string;
  url: string;
  type: string; // auto | hls | dash | ts | progressive
  user_agent?: string;
  referer?: string;
};

export type Group = {
  id: string;
  name: string;
  logo?: string;
  order: number;
};

export type Channel = {
  id: string;
  group_id: string;
  name: string;
  logo?: string;
  order: number;
  streams: Stream[];
};

async function req(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "خطأ" }));
    throw new Error(err.detail || "حدث خطأ");
  }
  return res.json();
}

export const api = {
  adminLogin: (password: string) =>
    req("/admin/login", { method: "POST", body: JSON.stringify({ password }) }),

  getGroups: (): Promise<Group[]> => req("/groups"),
  createGroup: (data: Partial<Group>): Promise<Group> =>
    req("/groups", { method: "POST", body: JSON.stringify(data) }),
  updateGroup: (id: string, data: Partial<Group>): Promise<Group> =>
    req(`/groups/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteGroup: (id: string) => req(`/groups/${id}`, { method: "DELETE" }),

  getChannels: (groupId?: string): Promise<Channel[]> =>
    req(groupId ? `/channels?group_id=${groupId}` : "/channels"),
  getChannel: (id: string): Promise<Channel> => req(`/channels/${id}`),
  createChannel: (data: Partial<Channel>): Promise<Channel> =>
    req("/channels", { method: "POST", body: JSON.stringify(data) }),
  updateChannel: (id: string, data: Partial<Channel>): Promise<Channel> =>
    req(`/channels/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteChannel: (id: string) => req(`/channels/${id}`, { method: "DELETE" }),
};
