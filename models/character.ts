export interface Character {
    id: number;
    name: string;
    accountId: string;
    allianceId?: number;
    corpId?: number;
    hash: string;
    sso?: Permissions;
    roles?: string[];
    titles?: any;
}

export interface Permissions {
    accessToken: string;
    refreshToken: string;
    scope?: string;
    expiresAt: number;
}