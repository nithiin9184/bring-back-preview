export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      auth_sessions: {
        Row: {
          created_at: string
          device_label: string
          expires_at: string | null
          id: string
          last_seen_at: string
          place: string
          platform: string
          revoked_at: string | null
          revoked_reason: string | null
          session_ref: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_label?: string
          expires_at?: string | null
          id?: string
          last_seen_at?: string
          place?: string
          platform?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          session_ref: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_label?: string
          expires_at?: string | null
          id?: string
          last_seen_at?: string
          place?: string
          platform?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          session_ref?: string
          user_id?: string
        }
        Relationships: []
      }
      backup_jobs: {
        Row: {
          attempts: number
          backup_id: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          include_media: boolean
          progress: number
          state: string
          trigger: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          backup_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          include_media?: boolean
          progress?: number
          state?: string
          trigger?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          backup_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          include_media?: boolean
          progress?: number
          state?: string
          trigger?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "backup_jobs_backup_id_fkey"
            columns: ["backup_id"]
            isOneToOne: false
            referencedRelation: "backups"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_rate_limits: {
        Row: {
          count: number
          operation: string
          user_id: string
          window_started_at: string
        }
        Insert: {
          count?: number
          operation: string
          user_id: string
          window_started_at?: string
        }
        Update: {
          count?: number
          operation?: string
          user_id?: string
          window_started_at?: string
        }
        Relationships: []
      }
      backup_settings: {
        Row: {
          auto_enabled: boolean
          frequency: string
          include_media: boolean
          next_run_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_enabled?: boolean
          frequency?: string
          include_media?: boolean
          next_run_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_enabled?: boolean
          frequency?: string
          include_media?: boolean
          next_run_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      backup_snapshots: {
        Row: {
          captured_at: string
          item_counts: Json
          payload_ciphertext: string
          payload_version: number
          user_id: string
        }
        Insert: {
          captured_at?: string
          item_counts?: Json
          payload_ciphertext: string
          payload_version: number
          user_id: string
        }
        Update: {
          captured_at?: string
          item_counts?: Json
          payload_ciphertext?: string
          payload_version?: number
          user_id?: string
        }
        Relationships: []
      }
      backups: {
        Row: {
          backup_version: number
          checksum: string
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          destination: string
          drive_file_id: string | null
          encryption: string
          id: string
          includes_media: boolean
          item_counts: Json
          size_bytes: number
          status: string
          user_id: string
        }
        Insert: {
          backup_version: number
          checksum: string
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          destination?: string
          drive_file_id?: string | null
          encryption?: string
          id?: string
          includes_media?: boolean
          item_counts?: Json
          size_bytes?: number
          status?: string
          user_id: string
        }
        Update: {
          backup_version?: number
          checksum?: string
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          destination?: string
          drive_file_id?: string | null
          encryption?: string
          id?: string
          includes_media?: boolean
          item_counts?: Json
          size_bytes?: number
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: []
      }
      call_signals: {
        Row: {
          call_id: string
          created_at: string
          id: number
          kind: string
          payload: Json
          sender_id: string
        }
        Insert: {
          call_id: string
          created_at?: string
          id?: number
          kind: string
          payload: Json
          sender_id: string
        }
        Update: {
          call_id?: string
          created_at?: string
          id?: number
          kind?: string
          payload?: Json
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_signals_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          call_type: string
          callee_id: string
          caller_id: string
          connected_at: string | null
          created_at: string
          duration_seconds: number
          end_reason: string | null
          ended_at: string | null
          id: string
          max_seconds: number | null
          status: string
        }
        Insert: {
          call_type: string
          callee_id: string
          caller_id: string
          connected_at?: string | null
          created_at?: string
          duration_seconds?: number
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          max_seconds?: number | null
          status?: string
        }
        Update: {
          call_type?: string
          callee_id?: string
          caller_id?: string
          connected_at?: string | null
          created_at?: string
          duration_seconds?: number
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          max_seconds?: number | null
          status?: string
        }
        Relationships: []
      }
      chat_media: {
        Row: {
          client_id: string
          created_at: string
          expires_at: string | null
          message_id: string | null
          mime: string
          path: string
          recipient_id: string
          sender_id: string
          size_bytes: number
        }
        Insert: {
          client_id: string
          created_at?: string
          expires_at?: string | null
          message_id?: string | null
          mime?: string
          path: string
          recipient_id: string
          sender_id: string
          size_bytes?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          expires_at?: string | null
          message_id?: string | null
          mime?: string
          path?: string
          recipient_id?: string
          sender_id?: string
          size_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_media_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_states: {
        Row: {
          accepted: boolean
          archived: boolean
          created_at: string
          disappearing: boolean
          draft: string
          last_message_at: string | null
          last_message_label: string
          last_message_preview: string
          last_read_at: string | null
          muted: boolean
          peer_name: string
          peer_username: string
          pinned: boolean
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted?: boolean
          archived?: boolean
          created_at?: string
          disappearing?: boolean
          draft?: string
          last_message_at?: string | null
          last_message_label?: string
          last_message_preview?: string
          last_read_at?: string | null
          muted?: boolean
          peer_name?: string
          peer_username: string
          pinned?: boolean
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted?: boolean
          archived?: boolean
          created_at?: string
          disappearing?: boolean
          draft?: string
          last_message_at?: string | null
          last_message_label?: string
          last_message_preview?: string
          last_read_at?: string | null
          muted?: boolean
          peer_name?: string
          peer_username?: string
          pinned?: boolean
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      connect_queue: {
        Row: {
          heartbeat_at: string
          joined_at: string
          user_id: string
        }
        Insert: {
          heartbeat_at?: string
          joined_at?: string
          user_id: string
        }
        Update: {
          heartbeat_at?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: []
      }
      connect_session_messages: {
        Row: {
          body: string
          client_id: string
          created_at: string
          id: string
          sender_id: string
          session_id: string
        }
        Insert: {
          body: string
          client_id: string
          created_at?: string
          id?: string
          sender_id: string
          session_id: string
        }
        Update: {
          body?: string
          client_id?: string
          created_at?: string
          id?: string
          sender_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_session_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "connect_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_sessions: {
        Row: {
          a_id: string
          a_vote: string | null
          b_id: string
          b_vote: string | null
          created_at: string
          ended_at: string | null
          id: string
        }
        Insert: {
          a_id: string
          a_vote?: string | null
          b_id: string
          b_vote?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
        }
        Update: {
          a_id?: string
          a_vote?: string | null
          b_id?: string
          b_vote?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
        }
        Relationships: []
      }
      connections: {
        Row: {
          created_at: string
          kind: string
          owner_id: string
          peer_id: string
        }
        Insert: {
          created_at?: string
          kind?: string
          owner_id: string
          peer_id: string
        }
        Update: {
          created_at?: string
          kind?: string
          owner_id?: string
          peer_id?: string
        }
        Relationships: []
      }
      contact_requests: {
        Row: {
          created_at: string
          id: string
          recipient_id: string
          resolved_at: string | null
          sender_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipient_id: string
          resolved_at?: string | null
          sender_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          recipient_id?: string
          resolved_at?: string | null
          sender_id?: string
          status?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          amount: number
          created_at: string
          day: string
          id: string
          kind: string
          payment_intent_id: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          day?: string
          id?: string
          kind: string
          payment_intent_id?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          day?: string
          id?: string
          kind?: string
          payment_intent_id?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      google_connections: {
        Row: {
          connected_at: string
          connection_key_ciphertext: string
          connector_id: string
          google_email: string | null
          last_checked_at: string | null
          revoked_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connected_at?: string
          connection_key_ciphertext: string
          connector_id?: string
          google_email?: string | null
          last_checked_at?: string | null
          revoked_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connected_at?: string
          connection_key_ciphertext?: string
          connector_id?: string
          google_email?: string | null
          last_checked_at?: string | null
          revoked_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string | null
          client_id: string
          created_at: string
          delivered_at: string | null
          id: string
          images: Json
          read_at: string | null
          recipient_id: string
          reply_to: string | null
          sender_id: string
        }
        Insert: {
          body?: string | null
          client_id: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          images?: Json
          read_at?: string | null
          recipient_id: string
          reply_to?: string | null
          sender_id: string
        }
        Update: {
          body?: string | null
          client_id?: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          images?: Json
          read_at?: string | null
          recipient_id?: string
          reply_to?: string | null
          sender_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          name: string
          text: string
          tone: string
          type: string
          unread: boolean
          user_id: string
          username: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          name?: string
          text: string
          tone?: string
          type: string
          unread?: boolean
          user_id: string
          username?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          name?: string
          text?: string
          tone?: string
          type?: string
          unread?: boolean
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      otp_challenges: {
        Row: {
          attempts: number
          channel: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          invalidated_reason: string | null
          max_attempts: number
          otp_hash: string
          phone_number_normalized: string
          resend_count: number
          superseded_at: string | null
        }
        Insert: {
          attempts?: number
          channel?: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          invalidated_reason?: string | null
          max_attempts?: number
          otp_hash: string
          phone_number_normalized: string
          resend_count?: number
          superseded_at?: string | null
        }
        Update: {
          attempts?: number
          channel?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invalidated_reason?: string | null
          max_attempts?: number
          otp_hash?: string
          phone_number_normalized?: string
          resend_count?: number
          superseded_at?: string | null
        }
        Relationships: []
      }
      payment_intents: {
        Row: {
          amount_inr: number
          created_at: string
          credits: number | null
          id: string
          kind: string
          plan_id: string | null
          provider: string
          provider_order_id: string | null
          provider_payment_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_inr: number
          created_at?: string
          credits?: number | null
          id?: string
          kind: string
          plan_id?: string | null
          provider?: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_inr?: number
          created_at?: string
          credits?: number | null
          id?: string
          kind?: string
          plan_id?: string | null
          provider?: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      phone_otps: {
        Row: {
          attempts: number
          code_hash: string
          consumed: boolean
          created_at: string
          expires_at: string
          id: string
          phone: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed?: boolean
          created_at?: string
          expires_at: string
          id?: string
          phone: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
        }
        Relationships: []
      }
      profile_likes: {
        Row: {
          created_at: string
          liked_id: string
          liker_id: string
        }
        Insert: {
          created_at?: string
          liked_id: string
          liker_id: string
        }
        Update: {
          created_at?: string
          liked_id?: string
          liker_id?: string
        }
        Relationships: []
      }
      profile_mutes: {
        Row: {
          created_at: string
          muted_username: string
          user_id: string
        }
        Insert: {
          created_at?: string
          muted_username: string
          user_id: string
        }
        Update: {
          created_at?: string
          muted_username?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          auth_status: string
          bio: string
          city: string
          created_at: string
          id: string
          is_private: boolean
          location: string
          name: string
          phone: string | null
          phone_number_normalized: string | null
          photo_url: string | null
          pin_code: string
          profile_completed: boolean
          region: string
          unique_id: string | null
          updated_at: string
          username: string | null
          village: string
        }
        Insert: {
          auth_status?: string
          bio?: string
          city?: string
          created_at?: string
          id: string
          is_private?: boolean
          location?: string
          name?: string
          phone?: string | null
          phone_number_normalized?: string | null
          photo_url?: string | null
          pin_code?: string
          profile_completed?: boolean
          region?: string
          unique_id?: string | null
          updated_at?: string
          username?: string | null
          village?: string
        }
        Update: {
          auth_status?: string
          bio?: string
          city?: string
          created_at?: string
          id?: string
          is_private?: boolean
          location?: string
          name?: string
          phone?: string | null
          phone_number_normalized?: string | null
          photo_url?: string | null
          pin_code?: string
          profile_completed?: boolean
          region?: string
          unique_id?: string | null
          updated_at?: string
          username?: string | null
          village?: string
        }
        Relationships: []
      }
      restore_jobs: {
        Row: {
          attempts: number
          backup_id: string
          created_at: string
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          progress: number
          restored_counts: Json
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          backup_id: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          progress?: number
          restored_counts?: Json
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          backup_id?: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          progress?: number
          restored_counts?: Json
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restore_jobs_backup_id_fkey"
            columns: ["backup_id"]
            isOneToOne: false
            referencedRelation: "backups"
            referencedColumns: ["id"]
          },
        ]
      }
      status_views: {
        Row: {
          audience: string
          status_id: string
          viewed_at: string
          viewer_id: string
        }
        Insert: {
          audience?: string
          status_id: string
          viewed_at?: string
          viewer_id: string
        }
        Update: {
          audience?: string
          status_id?: string
          viewed_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_views_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      statuses: {
        Row: {
          author_id: string
          background: string | null
          caption: string | null
          caption_x: number | null
          caption_y: number | null
          created_at: string
          expires_at: string
          id: string
          kind: string
          media_mime: string | null
          media_path: string | null
          text: string | null
          text_align: string | null
          text_y: number | null
          video_end: number | null
          video_start: number | null
          visibility: string
        }
        Insert: {
          author_id: string
          background?: string | null
          caption?: string | null
          caption_x?: number | null
          caption_y?: number | null
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          media_mime?: string | null
          media_path?: string | null
          text?: string | null
          text_align?: string | null
          text_y?: number | null
          video_end?: number | null
          video_start?: number | null
          visibility?: string
        }
        Update: {
          author_id?: string
          background?: string | null
          caption?: string | null
          caption_x?: number | null
          caption_y?: number | null
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          media_mime?: string | null
          media_path?: string | null
          text?: string | null
          text_align?: string | null
          text_y?: number | null
          video_end?: number | null
          video_start?: number | null
          visibility?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount_inr: number
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan: string
          plan_id: string
          provider: string | null
          provider_ref: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_inr?: number
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string
          plan_id?: string
          provider?: string | null
          provider_ref?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_inr?: number
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string
          plan_id?: string
          provider?: string | null
          provider_ref?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trust_choices: {
        Row: {
          created_at: string
          peer_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          peer_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          peer_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_reports: {
        Row: {
          created_at: string
          id: string
          reason: string
          reported_id: string | null
          reported_username: string
          reporter_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          reported_id?: string | null
          reported_username: string
          reporter_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          reported_id?: string | null
          reported_username?: string
          reporter_id?: string
          status?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          settings: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          settings?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          settings?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      call_entitlement: { Args: { _user_id: string }; Returns: Json }
      can_view_status: {
        Args: { _status_id: string; _viewer: string }
        Returns: boolean
      }
      connect_find_match: { Args: never; Returns: string }
      connect_leave: { Args: never; Returns: undefined }
      connect_session_member: {
        Args: { _session_id: string; _user_id: string }
        Returns: boolean
      }
      connect_session_writable: {
        Args: { _session_id: string; _user_id: string }
        Returns: boolean
      }
      credit_snapshot: { Args: { _user_id: string }; Returns: Json }
      entitlement_snapshot: { Args: { _user_id: string }; Returns: Json }
      is_blocked_pair: { Args: { _a: string; _b: string }; Returns: boolean }
      is_call_live: { Args: { _call_id: string }; Returns: boolean }
      is_call_participant: {
        Args: { _call_id: string; _user_id: string }
        Returns: boolean
      }
      is_connected: {
        Args: { _owner: string; _peer: string }
        Returns: boolean
      }
      is_premium: { Args: { _user_id: string }; Returns: boolean }
      issue_unique_id: { Args: never; Returns: string }
      mutual_trust: { Args: { _a: string; _b: string }; Returns: boolean }
      spend_connect_credit: {
        Args: { _amount?: number; _user_id: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
