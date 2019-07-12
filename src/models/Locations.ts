export type CharacterLocation = {
    id: number;
    name: string;
    corpId: number;
    allianceId?: number;
    location?: Location;
    ship?: Ship;
};

export type Ship = {
    name: string;
    typeId: number;
    type?: string;
    itemId: number;
}

export type Location = {
    structure?: Structure;
    system: System;
}

export type System = {
    id: number;
    name?: string;
}

export type Structure = {
    id: number;
    name?: string;
}