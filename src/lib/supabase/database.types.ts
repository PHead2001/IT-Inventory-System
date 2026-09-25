export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_members: {
        Row: {
          active: boolean
          can_manage_configuration: boolean
          created_at: string
          display_name: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          can_manage_configuration?: boolean
          created_at?: string
          display_name: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          can_manage_configuration?: boolean
          created_at?: string
          display_name?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      asset_events: {
        Row: {
          actor_id: string
          actor_name: string
          after_metadata: Json | null
          asset_id: string
          before_metadata: Json | null
          created_at: string
          from_location_id: string | null
          id: string
          kind: string
          reason: string | null
          to_location_id: string | null
          version: number
        }
        Insert: {
          actor_id: string
          actor_name: string
          after_metadata?: Json | null
          asset_id: string
          before_metadata?: Json | null
          created_at?: string
          from_location_id?: string | null
          id?: string
          kind: string
          reason?: string | null
          to_location_id?: string | null
          version: number
        }
        Update: {
          actor_id?: string
          actor_name?: string
          after_metadata?: Json | null
          asset_id?: string
          before_metadata?: Json | null
          created_at?: string
          from_location_id?: string | null
          id?: string
          kind?: string
          reason?: string | null
          to_location_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "asset_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "serialized_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_events_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_events_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_events: {
        Row: {
          actor_id: string
          actor_name: string
          asset_event_id: string | null
          asset_id: string | null
          created_at: string
          from_label: string | null
          from_location_id: string | null
          from_site_id: string | null
          id: string
          item_id: string | null
          kind: string
          quantity: number | null
          quantity_event_id: string | null
          reason: string | null
          reference: string | null
          to_label: string | null
          to_location_id: string | null
          to_site_id: string | null
        }
        Insert: {
          actor_id: string
          actor_name: string
          asset_event_id?: string | null
          asset_id?: string | null
          created_at?: string
          from_label?: string | null
          from_location_id?: string | null
          from_site_id?: string | null
          id?: string
          item_id?: string | null
          kind: string
          quantity?: number | null
          quantity_event_id?: string | null
          reason?: string | null
          reference?: string | null
          to_label?: string | null
          to_location_id?: string | null
          to_site_id?: string | null
        }
        Update: {
          actor_id?: string
          actor_name?: string
          asset_event_id?: string | null
          asset_id?: string | null
          created_at?: string
          from_label?: string | null
          from_location_id?: string | null
          from_site_id?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          quantity?: number | null
          quantity_event_id?: string | null
          reason?: string | null
          reference?: string | null
          to_label?: string | null
          to_location_id?: string | null
          to_site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignment_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "assignment_events_asset_event_id_fkey"
            columns: ["asset_event_id"]
            isOneToOne: true
            referencedRelation: "asset_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "serialized_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_events_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_events_from_site_id_fkey"
            columns: ["from_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_quantity_totals"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "assignment_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "quantity_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_events_quantity_event_id_fkey"
            columns: ["quantity_event_id"]
            isOneToOne: true
            referencedRelation: "quantity_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_events_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_events_to_site_id_fkey"
            columns: ["to_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          published_form_revision_id: string | null
          removed_at: string | null
          sort_order: number
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          published_form_revision_id?: string | null
          removed_at?: string | null
          sort_order?: number
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          published_form_revision_id?: string | null
          removed_at?: string | null
          sort_order?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "category_published_form_same_category"
            columns: ["published_form_revision_id"]
            isOneToOne: false
            referencedRelation: "category_form_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      category_form_revisions: {
        Row: {
          category_id: string | null
          created_at: string
          draft_definition: Json | null
          draft_version: number
          id: string
          published_at: string | null
          published_by: string | null
          revision_number: number
          status: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          draft_definition?: Json | null
          draft_version?: number
          id?: string
          published_at?: string | null
          published_by?: string | null
          revision_number: number
          status: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          draft_definition?: Json | null
          draft_version?: number
          id?: string
          published_at?: string | null
          published_by?: string | null
          revision_number?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_form_revisions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_form_revisions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "configuration_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_form_revisions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["user_id"]
          },
        ]
      }
      configuration_events: {
        Row: {
          actor_id: string
          actor_name: string
          affected_assets: number
          affected_quantity: number
          after_state: Json | null
          before_state: Json | null
          category_id: string | null
          created_at: string
          id: string
          kind: string
        }
        Insert: {
          actor_id: string
          actor_name: string
          affected_assets?: number
          affected_quantity?: number
          after_state?: Json | null
          before_state?: Json | null
          category_id?: string | null
          created_at?: string
          id?: string
          kind: string
        }
        Update: {
          actor_id?: string
          actor_name?: string
          affected_assets?: number
          affected_quantity?: number
          after_state?: Json | null
          before_state?: Json | null
          category_id?: string | null
          created_at?: string
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "configuration_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["user_id"]
          },
        ]
      }
      form_publication_events: {
        Row: {
          actor_id: string
          actor_name: string
          affected_assets: number
          affected_quantity: number
          category_id: string
          created_at: string
          id: string
          previous_revision_id: string | null
          revision_id: string
        }
        Insert: {
          actor_id: string
          actor_name: string
          affected_assets: number
          affected_quantity: number
          category_id: string
          created_at?: string
          id?: string
          previous_revision_id?: string | null
          revision_id: string
        }
        Update: {
          actor_id?: string
          actor_name?: string
          affected_assets?: number
          affected_quantity?: number
          category_id?: string
          created_at?: string
          id?: string
          previous_revision_id?: string | null
          revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_publication_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "form_publication_events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_publication_events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "configuration_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_publication_events_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "category_form_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_revision_controls: {
        Row: {
          builtin: string | null
          control_id: string
          field_id: string | null
          help: string | null
          kind: string
          revision_id: string
          section_id: string
          sort_order: number
          width: string
        }
        Insert: {
          builtin?: string | null
          control_id: string
          field_id?: string | null
          help?: string | null
          kind: string
          revision_id: string
          section_id: string
          sort_order: number
          width: string
        }
        Update: {
          builtin?: string | null
          control_id?: string
          field_id?: string | null
          help?: string | null
          kind?: string
          revision_id?: string
          section_id?: string
          sort_order?: number
          width?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_revision_controls_revision_id_field_id_fkey"
            columns: ["revision_id", "field_id"]
            isOneToOne: false
            referencedRelation: "form_revision_fields"
            referencedColumns: ["revision_id", "field_id"]
          },
          {
            foreignKeyName: "form_revision_controls_revision_id_section_id_fkey"
            columns: ["revision_id", "section_id"]
            isOneToOne: false
            referencedRelation: "form_revision_sections"
            referencedColumns: ["revision_id", "id"]
          },
        ]
      }
      form_revision_fields: {
        Row: {
          applies_to: string[]
          default_value: Json | null
          field_id: string
          help: string | null
          label: string
          required: boolean
          revision_id: string
          rules: Json
          sort_order: number
        }
        Insert: {
          applies_to: string[]
          default_value?: Json | null
          field_id: string
          help?: string | null
          label: string
          required: boolean
          revision_id: string
          rules?: Json
          sort_order: number
        }
        Update: {
          applies_to?: string[]
          default_value?: Json | null
          field_id?: string
          help?: string | null
          label?: string
          required?: boolean
          revision_id?: string
          rules?: Json
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_revision_fields_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "metadata_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_revision_fields_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "category_form_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_revision_options: {
        Row: {
          active: boolean
          field_id: string
          label: string
          option_id: string
          parent_option_id: string | null
          revision_id: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          field_id: string
          label: string
          option_id: string
          parent_option_id?: string | null
          revision_id: string
          sort_order: number
        }
        Update: {
          active?: boolean
          field_id?: string
          label?: string
          option_id?: string
          parent_option_id?: string | null
          revision_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_revision_options_option_id_field_id_fkey"
            columns: ["option_id", "field_id"]
            isOneToOne: false
            referencedRelation: "metadata_options"
            referencedColumns: ["id", "field_id"]
          },
          {
            foreignKeyName: "form_revision_options_revision_id_field_id_fkey"
            columns: ["revision_id", "field_id"]
            isOneToOne: false
            referencedRelation: "form_revision_fields"
            referencedColumns: ["revision_id", "field_id"]
          },
          {
            foreignKeyName: "form_revision_options_revision_id_field_id_parent_option_i_fkey"
            columns: ["revision_id", "field_id", "parent_option_id"]
            isOneToOne: false
            referencedRelation: "form_revision_options"
            referencedColumns: ["revision_id", "field_id", "option_id"]
          },
        ]
      }
      form_revision_sections: {
        Row: {
          id: string
          label: string
          revision_id: string
          sort_order: number
        }
        Insert: {
          id: string
          label: string
          revision_id: string
          sort_order: number
        }
        Update: {
          id?: string
          label?: string
          revision_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_revision_sections_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "category_form_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      label_defaults: {
        Row: {
          format: string
          page: string
          singleton: boolean
          size: string
          updated_at: string
          version: number
        }
        Insert: {
          format?: string
          page?: string
          singleton?: boolean
          size?: string
          updated_at?: string
          version?: number
        }
        Update: {
          format?: string
          page?: string
          singleton?: boolean
          size?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      location_configuration_events: {
        Row: {
          actor_id: string
          actor_name: string
          after_state: Json
          before_state: Json | null
          created_at: string
          id: string
          kind: string
          location_id: string
          version: number
        }
        Insert: {
          actor_id: string
          actor_name: string
          after_state: Json
          before_state?: Json | null
          created_at?: string
          id?: string
          kind: string
          location_id: string
          version: number
        }
        Update: {
          actor_id?: string
          actor_name?: string
          after_state?: Json
          before_state?: Json | null
          created_at?: string
          id?: string
          kind?: string
          location_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "location_configuration_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "location_configuration_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          active: boolean
          can_hold_inventory: boolean
          code: string
          created_at: string
          id: string
          kind: string
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          can_hold_inventory?: boolean
          code: string
          created_at?: string
          id?: string
          kind: string
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          can_hold_inventory?: boolean
          code?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "locations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      metadata_fields: {
        Row: {
          category_id: string
          created_at: string
          field_type: string
          id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          field_type: string
          id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          field_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "metadata_fields_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metadata_fields_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "configuration_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      metadata_options: {
        Row: {
          created_at: string
          field_id: string
          id: string
        }
        Insert: {
          created_at?: string
          field_id: string
          id: string
        }
        Update: {
          created_at?: string
          field_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "metadata_options_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "metadata_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      quantity_event_lines: {
        Row: {
          after_quantity: number
          before_quantity: number
          delta: number
          event_id: string
          location_id: string
        }
        Insert: {
          after_quantity: number
          before_quantity: number
          delta: number
          event_id: string
          location_id: string
        }
        Update: {
          after_quantity?: number
          before_quantity?: number
          delta?: number
          event_id?: string
          location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quantity_event_lines_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "quantity_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quantity_event_lines_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      quantity_events: {
        Row: {
          actor_id: string
          actor_name: string
          after_metadata: Json | null
          before_metadata: Json | null
          created_at: string
          id: string
          item_id: string
          kind: string
          reason: string | null
          version: number
        }
        Insert: {
          actor_id: string
          actor_name: string
          after_metadata?: Json | null
          before_metadata?: Json | null
          created_at?: string
          id?: string
          item_id: string
          kind: string
          reason?: string | null
          version: number
        }
        Update: {
          actor_id?: string
          actor_name?: string
          after_metadata?: Json | null
          before_metadata?: Json | null
          created_at?: string
          id?: string
          item_id?: string
          kind?: string
          reason?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quantity_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "quantity_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_quantity_totals"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "quantity_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "quantity_items"
            referencedColumns: ["id"]
          },
        ]
      }
      quantity_items: {
        Row: {
          archived: boolean
          category_id: string
          created_at: string
          custom_values: Json
          description: string | null
          id: string
          manufacturer: string | null
          model: string | null
          name: string
          needs_metadata: boolean
          reorder_threshold: number | null
          updated_at: string
          validated_form_revision_id: string | null
          version: number
        }
        Insert: {
          archived?: boolean
          category_id: string
          created_at?: string
          custom_values?: Json
          description?: string | null
          id?: string
          manufacturer?: string | null
          model?: string | null
          name: string
          needs_metadata?: boolean
          reorder_threshold?: number | null
          updated_at?: string
          validated_form_revision_id?: string | null
          version?: number
        }
        Update: {
          archived?: boolean
          category_id?: string
          created_at?: string
          custom_values?: Json
          description?: string | null
          id?: string
          manufacturer?: string | null
          model?: string | null
          name?: string
          needs_metadata?: boolean
          reorder_threshold?: number | null
          updated_at?: string
          validated_form_revision_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quantity_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quantity_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "configuration_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quantity_items_validated_form_revision_id_fkey"
            columns: ["validated_form_revision_id"]
            isOneToOne: false
            referencedRelation: "category_form_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      serialized_assets: {
        Row: {
          asset_tag: string | null
          category_id: string
          created_at: string
          custom_values: Json
          description: string | null
          id: string
          location_id: string | null
          manufacturer: string | null
          model: string | null
          name: string
          needs_metadata: boolean
          serial_number: string | null
          site_id: string | null
          status: string
          updated_at: string
          validated_form_revision_id: string | null
          version: number
        }
        Insert: {
          asset_tag?: string | null
          category_id: string
          created_at?: string
          custom_values?: Json
          description?: string | null
          id?: string
          location_id?: string | null
          manufacturer?: string | null
          model?: string | null
          name: string
          needs_metadata?: boolean
          serial_number?: string | null
          site_id?: string | null
          status?: string
          updated_at?: string
          validated_form_revision_id?: string | null
          version?: number
        }
        Update: {
          asset_tag?: string | null
          category_id?: string
          created_at?: string
          custom_values?: Json
          description?: string | null
          id?: string
          location_id?: string | null
          manufacturer?: string | null
          model?: string | null
          name?: string
          needs_metadata?: boolean
          serial_number?: string | null
          site_id?: string | null
          status?: string
          updated_at?: string
          validated_form_revision_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "serialized_assets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serialized_assets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "configuration_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serialized_assets_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serialized_assets_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serialized_assets_validated_form_revision_id_fkey"
            columns: ["validated_form_revision_id"]
            isOneToOne: false
            referencedRelation: "category_form_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      site_configuration_events: {
        Row: {
          actor_id: string
          actor_name: string
          after_state: Json
          before_state: Json | null
          created_at: string
          id: string
          kind: string
          site_id: string
          version: number
        }
        Insert: {
          actor_id: string
          actor_name: string
          after_state: Json
          before_state?: Json | null
          created_at?: string
          id?: string
          kind: string
          site_id: string
          version: number
        }
        Update: {
          actor_id?: string
          actor_name?: string
          after_state?: Json
          before_state?: Json | null
          created_at?: string
          id?: string
          kind?: string
          site_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "site_configuration_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "site_configuration_events_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_quantity_event_lines: {
        Row: {
          after_quantity: number
          before_quantity: number
          delta: number
          event_id: string
          site_id: string
        }
        Insert: {
          after_quantity: number
          before_quantity: number
          delta: number
          event_id: string
          site_id: string
        }
        Update: {
          after_quantity?: number
          before_quantity?: number
          delta?: number
          event_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_quantity_event_lines_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "quantity_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_quantity_event_lines_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_quantity_holdings: {
        Row: {
          item_id: string
          quantity: number
          site_id: string
        }
        Insert: {
          item_id: string
          quantity: number
          site_id: string
        }
        Update: {
          item_id?: string
          quantity?: number
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_quantity_holdings_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_quantity_totals"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "site_quantity_holdings_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "quantity_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_quantity_holdings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          notes: string | null
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      stock_balances: {
        Row: {
          item_id: string
          location_id: string
          quantity: number
        }
        Insert: {
          item_id: string
          location_id: string
          quantity: number
        }
        Update: {
          item_id?: string
          location_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_quantity_totals"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "stock_balances_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "quantity_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      configuration_categories: {
        Row: {
          active: boolean | null
          code: string | null
          created_at: string | null
          id: string | null
          name: string | null
          removed_at: string | null
          sort_order: number | null
          updated_at: string | null
          version: string | null
        }
        Insert: {
          active?: boolean | null
          code?: string | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          removed_at?: string | null
          sort_order?: number | null
          updated_at?: string | null
          version?: never
        }
        Update: {
          active?: boolean | null
          code?: string | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          removed_at?: string | null
          sort_order?: number | null
          updated_at?: string | null
          version?: never
        }
        Relationships: []
      }
      configuration_label_defaults: {
        Row: {
          format: string | null
          page: string | null
          size: string | null
          updated_at: string | null
          version: string | null
        }
        Insert: {
          format?: string | null
          page?: string | null
          size?: string | null
          updated_at?: string | null
          version?: never
        }
        Update: {
          format?: string | null
          page?: string | null
          size?: string | null
          updated_at?: string | null
          version?: never
        }
        Relationships: []
      }
      inventory_history_rows: {
        Row: {
          actor_name: string | null
          after_metadata: Json | null
          before_metadata: Json | null
          created_at: string | null
          custom_changed: boolean | null
          custom_present: boolean | null
          entity_id: string | null
          entity_name: string | null
          event_type: string | null
          from_location_id: string | null
          id: string | null
          kind: string | null
          lines: Json | null
          location_ids: string[] | null
          reason: string | null
          to_location_id: string | null
        }
        Relationships: []
      }
      inventory_locations: {
        Row: {
          active: boolean | null
          ancestor_codes: string[] | null
          breadcrumb: string | null
          can_hold_inventory: boolean | null
          code: string | null
          created_at: string | null
          id: string | null
          kind: string | null
          name: string | null
          parent_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      inventory_quantity_totals: {
        Row: {
          assigned_quantity: string | null
          available_quantity: string | null
          item_id: string | null
          recorded_quantity: string | null
          stock_state: string | null
        }
        Relationships: []
      }
      inventory_search_rows: {
        Row: {
          ancestor_codes: string[] | null
          asset_tag: string | null
          breadcrumb: string | null
          category_id: string | null
          category_name: string | null
          description: string | null
          entity_id: string | null
          kind: string | null
          location_code: string | null
          location_id: string | null
          location_name: string | null
          manufacturer: string | null
          model: string | null
          name: string | null
          quantity: number | null
          recorded_total: number | null
          reorder_threshold: number | null
          serial_number: string | null
          status: string | null
          stock_state: string | null
        }
        Relationships: []
      }
      site_current_holdings: {
        Row: {
          asset_tag: string | null
          category_name: string | null
          entity_id: string | null
          inventory_kind: string | null
          manufacturer: string | null
          model: string | null
          name: string | null
          quantity: number | null
          serial_number: string | null
          site_active: boolean | null
          site_code: string | null
          site_id: string | null
          site_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      asset_correct_location: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      asset_create: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      asset_create_v2: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      asset_move: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      asset_restore: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      asset_retire: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      asset_site_change: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      asset_site_open: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      asset_update: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      asset_update_v2: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      category_create: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      category_removal_review: {
        Args: { p_category_id: string; p_replacement_id?: string }
        Returns: Json
      }
      category_remove: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      category_rename: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      inventory_export_snapshot:
        | {
            Args: {
              p_category_id?: string
              p_export_type?: string
              p_location_code?: string
              p_low_stock?: boolean
              p_query?: string
              p_status?: string
              p_type?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_category_id: string
              p_export_type: string
              p_include_custom: boolean
              p_location_code: string
              p_low_stock: boolean
              p_query: string
              p_status: string
              p_type: string
            }
            Returns: Json
          }
      inventory_history: {
        Args: {
          p_entity_id?: string
          p_location_code?: string
          p_page?: number
          p_page_size?: number
          p_type?: string
        }
        Returns: Json
      }
      inventory_label_resolve: { Args: { p_selection: Json }; Returns: Json }
      inventory_label_search: {
        Args: {
          p_category_id?: string
          p_location_code?: string
          p_page?: number
          p_page_size?: number
          p_query?: string
          p_status?: string
          p_type?: string
        }
        Returns: Json
      }
      inventory_search: {
        Args: {
          p_category_id?: string
          p_location_code?: string
          p_page?: number
          p_page_size?: number
          p_query?: string
          p_status?: string
          p_type?: string
        }
        Returns: Json
      }
      inventory_search_v2: {
        Args: {
          p_category_id?: string
          p_location_code?: string
          p_low_stock?: boolean
          p_page?: number
          p_page_size?: number
          p_query?: string
          p_status?: string
          p_type?: string
        }
        Returns: Json
      }
      inventory_serial_matches: {
        Args: { p_exclude_id?: string; p_serial: string }
        Returns: {
          asset_tag: string
          id: string
          name: string
          status: string
        }[]
      }
      label_defaults_update: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      location_create: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      location_update: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      low_stock_dashboard: {
        Args: { p_page?: number; p_page_size?: number }
        Returns: Json
      }
      metadata_describe_batch: {
        Args: { p_keys: Json; p_mode: string }
        Returns: Json
      }
      metadata_describe_values: {
        Args: { p_current_category: string; p_values: Json }
        Returns: Json
      }
      metadata_draft_discard: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      metadata_draft_save: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      metadata_event_custom_page: {
        Args: {
          p_event_id: string
          p_field_id?: string
          p_kind: string
          p_option_offset?: number
          p_side: string
        }
        Returns: Json
      }
      metadata_form_get: { Args: { p_category_id: string }; Returns: Json }
      metadata_publish: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      metadata_publish_review: { Args: { p_payload: Json }; Returns: Json }
      quantity_adjust: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      quantity_archive: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      quantity_archive_and_clear: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      quantity_archive_review: { Args: { p_item_id: string }; Returns: Json }
      quantity_create: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      quantity_create_v2: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      quantity_move: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      quantity_receive: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      quantity_restore: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      quantity_site_change: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      quantity_site_open: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      quantity_update: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      quantity_update_v2: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      site_activity_summary: {
        Args: { p_from?: string; p_site_id: string; p_until?: string }
        Returns: Json
      }
      site_create: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
      site_update: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
