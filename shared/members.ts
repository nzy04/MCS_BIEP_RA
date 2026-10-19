export interface SiteMember {
  id: number;
  login: string;
  name: string;
  joinedAt: string;
  active: boolean;
}
export interface SiteInvitation {
  url: string;
  expiresAt: string;
  uses: number;
  maxUses: number;
}
export interface MembersData {
  members: SiteMember[];
  invitation: SiteInvitation | null;
  configured: boolean;
}
export interface InvitationPreview {
  valid: boolean;
  message: string;
  expiresAt?: string;
}
