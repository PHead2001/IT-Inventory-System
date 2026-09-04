export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = { public: { Tables: {
app_members: {
Row: {
user_id: string;
display_name: string;
role: string;
active: boolean;
created_at: string;
updated_at: string;
};
Insert: {
user_id: string;
display_name: string;
role: string;
active?: boolean;
created_at?: string;
updated_at?: string;
};
Update: {
user_id?: string;
display_name?: string;
role?: string;
active?: boolean;
created_at?: string;
updated_at?: string;
};
Relationships: [{"foreignKeyName":"app_members_user_id_fkey","columns":["user_id"],"isOneToOne":true,"referencedRelation":"users","referencedColumns":["id"]}];
};
categories: {
Row: {
id: string;
code: string;
name: string;
active: boolean;
sort_order: number;
created_at: string;
updated_at: string;
};
Insert: {
id?: string;
code: string;
name: string;
active?: boolean;
sort_order?: number;
created_at?: string;
updated_at?: string;
};
Update: {
id?: string;
code?: string;
name?: string;
active?: boolean;
sort_order?: number;
created_at?: string;
updated_at?: string;
};
Relationships: [];
};
locations: {
Row: {
id: string;
code: string;
name: string;
parent_id: string | null;
kind: string;
can_hold_inventory: boolean;
active: boolean;
sort_order: number;
created_at: string;
updated_at: string;
};
Insert: {
id?: string;
code: string;
name: string;
parent_id?: string | null;
kind: string;
can_hold_inventory?: boolean;
active?: boolean;
sort_order?: number;
created_at?: string;
updated_at?: string;
};
Update: {
id?: string;
code?: string;
name?: string;
parent_id?: string | null;
kind?: string;
can_hold_inventory?: boolean;
active?: boolean;
sort_order?: number;
created_at?: string;
updated_at?: string;
};
Relationships: [{"foreignKeyName":"locations_parent_id_fkey","columns":["parent_id"],"isOneToOne":false,"referencedRelation":"locations","referencedColumns":["id"]}];
};
}; Views: { [_ in never]: never }; Functions: { [_ in never]: never }; Enums: { [_ in never]: never }; CompositeTypes: { [_ in never]: never }; } };

