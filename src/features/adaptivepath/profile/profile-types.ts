import type { loadProfileData } from "@/server/adaptivepath/session";

export type ProfileData = Awaited<ReturnType<typeof loadProfileData>>;
