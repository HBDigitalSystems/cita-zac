// GENERADO AUTOMÁTICAMENTE — no editar a mano.
// Fuente: supabase/migrations/*.sql
// Regenerar con: bun run db:types
//
// Se genera introspeccionando el esquema con PGlite en lugar de
// `supabase gen types`, que necesita Docker. El formato imita al oficial para
// poder cambiar de generador sin tocar el código que lo consume.

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
      appointments: {
        Row: {
          id: string
          reference: string
          patient_id: string
          doctor_id: string
          consulting_room_id: string | null
          starts_at: string
          ends_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          modality: Database["public"]["Enums"]["appointment_modality"]
          reason: string | null
          patient_notes: string | null
          is_first_visit: boolean
          price_cents: number | null
          currency: string
          cancelled_at: string | null
          cancelled_by: string | null
          cancellation_reason: string | null
          rescheduled_to: string | null
          video_room_url: string | null
          video_provider: string | null
          reminder_sent_at: string | null
          confirmed_at: string | null
          completed_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          reference?: string
          patient_id: string
          doctor_id: string
          consulting_room_id?: string | null
          starts_at: string
          ends_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          modality?: Database["public"]["Enums"]["appointment_modality"]
          reason?: string | null
          patient_notes?: string | null
          is_first_visit?: boolean
          price_cents?: number | null
          currency?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancellation_reason?: string | null
          rescheduled_to?: string | null
          video_room_url?: string | null
          video_provider?: string | null
          reminder_sent_at?: string | null
          confirmed_at?: string | null
          completed_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          reference?: string
          patient_id?: string
          doctor_id?: string
          consulting_room_id?: string | null
          starts_at?: string
          ends_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          modality?: Database["public"]["Enums"]["appointment_modality"]
          reason?: string | null
          patient_notes?: string | null
          is_first_visit?: boolean
          price_cents?: number | null
          currency?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancellation_reason?: string | null
          rescheduled_to?: string | null
          video_room_url?: string | null
          video_provider?: string | null
          reminder_sent_at?: string | null
          confirmed_at?: string | null
          completed_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_cancelled_by_fkey"
            columns: ["cancelled_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_consulting_room_id_fkey"
            columns: ["consulting_room_id"]
            referencedRelation: "consulting_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_rescheduled_to_fkey"
            columns: ["rescheduled_to"]
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          }
        ]
      }
      audit_logs: {
        Row: {
          id: number
          table_name: string
          record_id: string
          action: Database["public"]["Enums"]["audit_action"]
          actor_id: string | null
          old_data: Json | null
          new_data: Json | null
          changed_keys: string[] | null
          ip_address: string | null
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: number
          table_name: string
          record_id: string
          action: Database["public"]["Enums"]["audit_action"]
          actor_id?: string | null
          old_data?: Json | null
          new_data?: Json | null
          changed_keys?: string[] | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          table_name?: string
          record_id?: string
          action?: Database["public"]["Enums"]["audit_action"]
          actor_id?: string | null
          old_data?: Json | null
          new_data?: Json | null
          changed_keys?: string[] | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      availability_exceptions: {
        Row: {
          id: string
          doctor_id: string
          consulting_room_id: string | null
          exception_type: Database["public"]["Enums"]["availability_exception_type"]
          starts_at: string
          ends_at: string
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          doctor_id: string
          consulting_room_id?: string | null
          exception_type: Database["public"]["Enums"]["availability_exception_type"]
          starts_at: string
          ends_at: string
          reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          doctor_id?: string
          consulting_room_id?: string | null
          exception_type?: Database["public"]["Enums"]["availability_exception_type"]
          starts_at?: string
          ends_at?: string
          reason?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_consulting_room_id_fkey"
            columns: ["consulting_room_id"]
            referencedRelation: "consulting_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exceptions_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          }
        ]
      }
      consulting_rooms: {
        Row: {
          id: string
          doctor_id: string
          facility_id: string | null
          name: string
          municipality_id: number
          address: string
          address_details: string | null
          postal_code: string | null
          phone: string | null
          latitude: number | null
          longitude: number | null
          google_place_id: string | null
          photos: string[]
          amenities: string[]
          has_parking: boolean
          is_accessible: boolean
          slot_duration_minutes: number
          buffer_minutes: number
          is_primary: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          doctor_id: string
          facility_id?: string | null
          name: string
          municipality_id: number
          address: string
          address_details?: string | null
          postal_code?: string | null
          phone?: string | null
          latitude?: number | null
          longitude?: number | null
          google_place_id?: string | null
          photos?: string[]
          amenities?: string[]
          has_parking?: boolean
          is_accessible?: boolean
          slot_duration_minutes?: number
          buffer_minutes?: number
          is_primary?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          doctor_id?: string
          facility_id?: string | null
          name?: string
          municipality_id?: number
          address?: string
          address_details?: string | null
          postal_code?: string | null
          phone?: string | null
          latitude?: number | null
          longitude?: number | null
          google_place_id?: string | null
          photos?: string[]
          amenities?: string[]
          has_parking?: boolean
          is_accessible?: boolean
          slot_duration_minutes?: number
          buffer_minutes?: number
          is_primary?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consulting_rooms_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consulting_rooms_facility_id_fkey"
            columns: ["facility_id"]
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consulting_rooms_municipality_id_fkey"
            columns: ["municipality_id"]
            referencedRelation: "municipalities"
            referencedColumns: ["id"]
          }
        ]
      }
      conversations: {
        Row: {
          id: string
          patient_id: string
          doctor_id: string
          last_message_at: string | null
          last_message_preview: string | null
          patient_unread_count: number
          doctor_unread_count: number
          is_archived: boolean
          created_at: string
        }
        Insert: {
          id?: string
          patient_id: string
          doctor_id: string
          last_message_at?: string | null
          last_message_preview?: string | null
          patient_unread_count?: number
          doctor_unread_count?: number
          is_archived?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          patient_id?: string
          doctor_id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          patient_unread_count?: number
          doctor_unread_count?: number
          is_archived?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_patient_id_fkey"
            columns: ["patient_id"]
            referencedRelation: "patients"
            referencedColumns: ["id"]
          }
        ]
      }
      doctor_awards: {
        Row: {
          id: string
          doctor_id: string
          title: string
          awarded_by: string | null
          awarded_year: number | null
          display_order: number
        }
        Insert: {
          id?: string
          doctor_id: string
          title: string
          awarded_by?: string | null
          awarded_year?: number | null
          display_order?: number
        }
        Update: {
          id?: string
          doctor_id?: string
          title?: string
          awarded_by?: string | null
          awarded_year?: number | null
          display_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "doctor_awards_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          }
        ]
      }
      doctor_certifications: {
        Row: {
          id: string
          doctor_id: string
          title: string
          issuing_body: string | null
          issued_year: number | null
          document_url: string | null
          display_order: number
        }
        Insert: {
          id?: string
          doctor_id: string
          title: string
          issuing_body?: string | null
          issued_year?: number | null
          document_url?: string | null
          display_order?: number
        }
        Update: {
          id?: string
          doctor_id?: string
          title?: string
          issuing_body?: string | null
          issued_year?: number | null
          document_url?: string | null
          display_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "doctor_certifications_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          }
        ]
      }
      doctor_facilities: {
        Row: {
          doctor_id: string
          facility_id: string
          role: string | null
        }
        Insert: {
          doctor_id: string
          facility_id: string
          role?: string | null
        }
        Update: {
          doctor_id?: string
          facility_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_facilities_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_facilities_facility_id_fkey"
            columns: ["facility_id"]
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          }
        ]
      }
      doctor_faqs: {
        Row: {
          id: string
          doctor_id: string
          question: string
          answer: string
          display_order: number
        }
        Insert: {
          id?: string
          doctor_id: string
          question: string
          answer: string
          display_order?: number
        }
        Update: {
          id?: string
          doctor_id?: string
          question?: string
          answer?: string
          display_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "doctor_faqs_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          }
        ]
      }
      doctor_insurances: {
        Row: {
          doctor_id: string
          insurance_company_id: number
        }
        Insert: {
          doctor_id: string
          insurance_company_id: number
        }
        Update: {
          doctor_id?: string
          insurance_company_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "doctor_insurances_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_insurances_insurance_company_id_fkey"
            columns: ["insurance_company_id"]
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          }
        ]
      }
      doctor_languages: {
        Row: {
          doctor_id: string
          language_id: number
        }
        Insert: {
          doctor_id: string
          language_id: number
        }
        Update: {
          doctor_id?: string
          language_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "doctor_languages_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_languages_language_id_fkey"
            columns: ["language_id"]
            referencedRelation: "languages"
            referencedColumns: ["id"]
          }
        ]
      }
      doctor_media: {
        Row: {
          id: string
          doctor_id: string
          media_type: Database["public"]["Enums"]["media_type"]
          url: string
          thumbnail_url: string | null
          caption: string | null
          display_order: number
          created_at: string
        }
        Insert: {
          id?: string
          doctor_id: string
          media_type: Database["public"]["Enums"]["media_type"]
          url: string
          thumbnail_url?: string | null
          caption?: string | null
          display_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          doctor_id?: string
          media_type?: Database["public"]["Enums"]["media_type"]
          url?: string
          thumbnail_url?: string | null
          caption?: string | null
          display_order?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_media_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          }
        ]
      }
      doctor_profiles: {
        Row: {
          doctor_id: string
          headline: string | null
          biography: string | null
          photo_url: string | null
          cover_photo_url: string | null
          signature_url: string | null
          cv_url: string | null
          price_in_person_cents: number | null
          price_video_cents: number | null
          price_follow_up_cents: number | null
          price_home_visit_cents: number | null
          currency: string
          accepts_new_patients: boolean
          offers_telemedicine: boolean
          offers_emergency: boolean
          offers_home_visits: boolean
          cancellation_policy: string | null
          cancellation_hours: number
          average_response_minutes: number | null
          website: string | null
          facebook_url: string | null
          instagram_url: string | null
          linkedin_url: string | null
          whatsapp_phone: string | null
          created_at: string
          updated_at: string
          display_name: string | null
        }
        Insert: {
          doctor_id: string
          headline?: string | null
          biography?: string | null
          photo_url?: string | null
          cover_photo_url?: string | null
          signature_url?: string | null
          cv_url?: string | null
          price_in_person_cents?: number | null
          price_video_cents?: number | null
          price_follow_up_cents?: number | null
          price_home_visit_cents?: number | null
          currency?: string
          accepts_new_patients?: boolean
          offers_telemedicine?: boolean
          offers_emergency?: boolean
          offers_home_visits?: boolean
          cancellation_policy?: string | null
          cancellation_hours?: number
          average_response_minutes?: number | null
          website?: string | null
          facebook_url?: string | null
          instagram_url?: string | null
          linkedin_url?: string | null
          whatsapp_phone?: string | null
          created_at?: string
          updated_at?: string
          display_name?: string | null
        }
        Update: {
          doctor_id?: string
          headline?: string | null
          biography?: string | null
          photo_url?: string | null
          cover_photo_url?: string | null
          signature_url?: string | null
          cv_url?: string | null
          price_in_person_cents?: number | null
          price_video_cents?: number | null
          price_follow_up_cents?: number | null
          price_home_visit_cents?: number | null
          currency?: string
          accepts_new_patients?: boolean
          offers_telemedicine?: boolean
          offers_emergency?: boolean
          offers_home_visits?: boolean
          cancellation_policy?: string | null
          cancellation_hours?: number
          average_response_minutes?: number | null
          website?: string | null
          facebook_url?: string | null
          instagram_url?: string | null
          linkedin_url?: string | null
          whatsapp_phone?: string | null
          created_at?: string
          updated_at?: string
          display_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_profiles_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          }
        ]
      }
      doctor_services: {
        Row: {
          id: string
          doctor_id: string
          name: string
          description: string | null
          price_cents: number | null
          duration_minutes: number | null
          display_order: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          doctor_id: string
          name: string
          description?: string | null
          price_cents?: number | null
          duration_minutes?: number | null
          display_order?: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          doctor_id?: string
          name?: string
          description?: string | null
          price_cents?: number | null
          duration_minutes?: number | null
          display_order?: number
          is_active?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_services_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          }
        ]
      }
      doctor_specialties: {
        Row: {
          doctor_id: string
          specialty_id: number
        }
        Insert: {
          doctor_id: string
          specialty_id: number
        }
        Update: {
          doctor_id?: string
          specialty_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "doctor_specialties_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_specialties_specialty_id_fkey"
            columns: ["specialty_id"]
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          }
        ]
      }
      doctor_subspecialties: {
        Row: {
          doctor_id: string
          subspecialty_id: number
        }
        Insert: {
          doctor_id: string
          subspecialty_id: number
        }
        Update: {
          doctor_id?: string
          subspecialty_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "doctor_subspecialties_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_subspecialties_subspecialty_id_fkey"
            columns: ["subspecialty_id"]
            referencedRelation: "subspecialties"
            referencedColumns: ["id"]
          }
        ]
      }
      doctors: {
        Row: {
          id: string
          user_id: string
          slug: string
          license_number: string
          specialty_license_number: string | null
          university: string | null
          graduation_year: number | null
          years_of_experience: number | null
          primary_specialty_id: number | null
          gender: Database["public"]["Enums"]["gender"] | null
          status: Database["public"]["Enums"]["doctor_status"]
          verified_at: string | null
          verified_by: string | null
          rejection_reason: string | null
          has_active_subscription: boolean
          rating_average: number
          reviews_count: number
          appointments_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          slug?: string
          license_number: string
          specialty_license_number?: string | null
          university?: string | null
          graduation_year?: number | null
          years_of_experience?: number | null
          primary_specialty_id?: number | null
          gender?: Database["public"]["Enums"]["gender"] | null
          status?: Database["public"]["Enums"]["doctor_status"]
          verified_at?: string | null
          verified_by?: string | null
          rejection_reason?: string | null
          has_active_subscription?: boolean
          rating_average?: number
          reviews_count?: number
          appointments_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          slug?: string
          license_number?: string
          specialty_license_number?: string | null
          university?: string | null
          graduation_year?: number | null
          years_of_experience?: number | null
          primary_specialty_id?: number | null
          gender?: Database["public"]["Enums"]["gender"] | null
          status?: Database["public"]["Enums"]["doctor_status"]
          verified_at?: string | null
          verified_by?: string | null
          rejection_reason?: string | null
          has_active_subscription?: boolean
          rating_average?: number
          reviews_count?: number
          appointments_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctors_primary_specialty_id_fkey"
            columns: ["primary_specialty_id"]
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctors_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctors_verified_by_fkey"
            columns: ["verified_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      documents: {
        Row: {
          id: string
          patient_id: string
          uploaded_by: string
          doctor_id: string | null
          appointment_id: string | null
          medical_record_id: string | null
          document_type: Database["public"]["Enums"]["document_type"]
          title: string
          description: string | null
          storage_path: string
          mime_type: string | null
          size_bytes: number | null
          is_visible_to_patient: boolean
          created_at: string
        }
        Insert: {
          id?: string
          patient_id: string
          uploaded_by: string
          doctor_id?: string | null
          appointment_id?: string | null
          medical_record_id?: string | null
          document_type?: Database["public"]["Enums"]["document_type"]
          title: string
          description?: string | null
          storage_path: string
          mime_type?: string | null
          size_bytes?: number | null
          is_visible_to_patient?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          patient_id?: string
          uploaded_by?: string
          doctor_id?: string | null
          appointment_id?: string | null
          medical_record_id?: string | null
          document_type?: Database["public"]["Enums"]["document_type"]
          title?: string
          description?: string | null
          storage_path?: string
          mime_type?: string | null
          size_bytes?: number | null
          is_visible_to_patient?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_appointment_id_fkey"
            columns: ["appointment_id"]
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_medical_record_id_fkey"
            columns: ["medical_record_id"]
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_patient_id_fkey"
            columns: ["patient_id"]
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      facilities: {
        Row: {
          id: string
          facility_type: Database["public"]["Enums"]["facility_type"]
          name: string
          slug: string
          municipality_id: number
          address: string | null
          postal_code: string | null
          phone: string | null
          email: unknown | null
          website: string | null
          latitude: number | null
          longitude: number | null
          logo_url: string | null
          photos: string[]
          services: string[]
          is_verified: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          facility_type: Database["public"]["Enums"]["facility_type"]
          name: string
          slug: string
          municipality_id: number
          address?: string | null
          postal_code?: string | null
          phone?: string | null
          email?: unknown | null
          website?: string | null
          latitude?: number | null
          longitude?: number | null
          logo_url?: string | null
          photos?: string[]
          services?: string[]
          is_verified?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          facility_type?: Database["public"]["Enums"]["facility_type"]
          name?: string
          slug?: string
          municipality_id?: number
          address?: string | null
          postal_code?: string | null
          phone?: string | null
          email?: unknown | null
          website?: string | null
          latitude?: number | null
          longitude?: number | null
          logo_url?: string | null
          photos?: string[]
          services?: string[]
          is_verified?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilities_municipality_id_fkey"
            columns: ["municipality_id"]
            referencedRelation: "municipalities"
            referencedColumns: ["id"]
          }
        ]
      }
      favorites: {
        Row: {
          patient_id: string
          doctor_id: string
          created_at: string
        }
        Insert: {
          patient_id: string
          doctor_id: string
          created_at?: string
        }
        Update: {
          patient_id?: string
          doctor_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_patient_id_fkey"
            columns: ["patient_id"]
            referencedRelation: "patients"
            referencedColumns: ["id"]
          }
        ]
      }
      insurance_companies: {
        Row: {
          id: number
          name: string
          slug: string
          logo_url: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: number
          name: string
          slug: string
          logo_url?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: number
          name?: string
          slug?: string
          logo_url?: string | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          payment_id: string | null
          user_id: string
          folio: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          currency: string
          rfc: string | null
          legal_name: string | null
          tax_regime: string | null
          cfdi_use: string | null
          cfdi_uuid: string | null
          pdf_url: string | null
          xml_url: string | null
          issued_at: string
          created_at: string
        }
        Insert: {
          id?: string
          payment_id?: string | null
          user_id: string
          folio?: string
          subtotal_cents: number
          tax_cents?: number
          total_cents: number
          currency?: string
          rfc?: string | null
          legal_name?: string | null
          tax_regime?: string | null
          cfdi_use?: string | null
          cfdi_uuid?: string | null
          pdf_url?: string | null
          xml_url?: string | null
          issued_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          payment_id?: string | null
          user_id?: string
          folio?: string
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          currency?: string
          rfc?: string | null
          legal_name?: string | null
          tax_regime?: string | null
          cfdi_use?: string | null
          cfdi_uuid?: string | null
          pdf_url?: string | null
          xml_url?: string | null
          issued_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_payment_id_fkey"
            columns: ["payment_id"]
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      languages: {
        Row: {
          id: number
          code: string
          name: string
          is_active: boolean
        }
        Insert: {
          id?: number
          code: string
          name: string
          is_active?: boolean
        }
        Update: {
          id?: number
          code?: string
          name?: string
          is_active?: boolean
        }
        Relationships: []
      }
      medical_records: {
        Row: {
          id: string
          appointment_id: string | null
          patient_id: string
          doctor_id: string
          chief_complaint: string | null
          history: string | null
          physical_exam: string | null
          diagnosis: string | null
          icd10_codes: string[]
          treatment_plan: string | null
          notes: string | null
          follow_up_date: string | null
          vitals: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          appointment_id?: string | null
          patient_id: string
          doctor_id: string
          chief_complaint?: string | null
          history?: string | null
          physical_exam?: string | null
          diagnosis?: string | null
          icd10_codes?: string[]
          treatment_plan?: string | null
          notes?: string | null
          follow_up_date?: string | null
          vitals?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          appointment_id?: string | null
          patient_id?: string
          doctor_id?: string
          chief_complaint?: string | null
          history?: string | null
          physical_exam?: string | null
          diagnosis?: string | null
          icd10_codes?: string[]
          treatment_plan?: string | null
          notes?: string | null
          follow_up_date?: string | null
          vitals?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_records_appointment_id_fkey"
            columns: ["appointment_id"]
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_patient_id_fkey"
            columns: ["patient_id"]
            referencedRelation: "patients"
            referencedColumns: ["id"]
          }
        ]
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          sender_id: string
          body: string | null
          attachments: Json
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          sender_id: string
          body?: string | null
          attachments?: Json
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          sender_id?: string
          body?: string | null
          attachments?: Json
          read_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      municipalities: {
        Row: {
          id: number
          name: string
          slug: string
          inegi_code: string | null
          state: string
          latitude: number | null
          longitude: number | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: number
          name: string
          slug: string
          inegi_code?: string | null
          state?: string
          latitude?: number | null
          longitude?: number | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: number
          name?: string
          slug?: string
          inegi_code?: string | null
          state?: string
          latitude?: number | null
          longitude?: number | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          notification_type: Database["public"]["Enums"]["notification_type"]
          channel: Database["public"]["Enums"]["notification_channel"]
          title: string
          body: string | null
          action_url: string | null
          payload: Json
          read_at: string | null
          sent_at: string | null
          failed_at: string | null
          failure_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          notification_type: Database["public"]["Enums"]["notification_type"]
          channel?: Database["public"]["Enums"]["notification_channel"]
          title: string
          body?: string | null
          action_url?: string | null
          payload?: Json
          read_at?: string | null
          sent_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          notification_type?: Database["public"]["Enums"]["notification_type"]
          channel?: Database["public"]["Enums"]["notification_channel"]
          title?: string
          body?: string | null
          action_url?: string | null
          payload?: Json
          read_at?: string | null
          sent_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      patients: {
        Row: {
          id: string
          user_id: string
          curp: string | null
          birth_date: string | null
          gender: Database["public"]["Enums"]["gender"] | null
          blood_type: Database["public"]["Enums"]["blood_type"] | null
          municipality_id: number | null
          address: string | null
          postal_code: string | null
          allergies: string[]
          chronic_conditions: string[]
          current_medications: string[]
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          insurance_company_id: number | null
          insurance_policy_number: string | null
          accepted_terms_at: string | null
          accepted_privacy_at: string | null
          marketing_opt_in: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          curp?: string | null
          birth_date?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          blood_type?: Database["public"]["Enums"]["blood_type"] | null
          municipality_id?: number | null
          address?: string | null
          postal_code?: string | null
          allergies?: string[]
          chronic_conditions?: string[]
          current_medications?: string[]
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          insurance_company_id?: number | null
          insurance_policy_number?: string | null
          accepted_terms_at?: string | null
          accepted_privacy_at?: string | null
          marketing_opt_in?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          curp?: string | null
          birth_date?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          blood_type?: Database["public"]["Enums"]["blood_type"] | null
          municipality_id?: number | null
          address?: string | null
          postal_code?: string | null
          allergies?: string[]
          chronic_conditions?: string[]
          current_medications?: string[]
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          insurance_company_id?: number | null
          insurance_policy_number?: string | null
          accepted_terms_at?: string | null
          accepted_privacy_at?: string | null
          marketing_opt_in?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_insurance_company_id_fkey"
            columns: ["insurance_company_id"]
            referencedRelation: "insurance_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_municipality_id_fkey"
            columns: ["municipality_id"]
            referencedRelation: "municipalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      payments: {
        Row: {
          id: string
          subscription_id: string | null
          appointment_id: string | null
          payer_user_id: string
          amount_cents: number
          currency: string
          status: Database["public"]["Enums"]["payment_status"]
          method: Database["public"]["Enums"]["payment_method"] | null
          provider: string | null
          provider_payment_id: string | null
          provider_payload: Json | null
          paid_at: string | null
          failed_at: string | null
          failure_reason: string | null
          refunded_cents: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          subscription_id?: string | null
          appointment_id?: string | null
          payer_user_id: string
          amount_cents: number
          currency?: string
          status?: Database["public"]["Enums"]["payment_status"]
          method?: Database["public"]["Enums"]["payment_method"] | null
          provider?: string | null
          provider_payment_id?: string | null
          provider_payload?: Json | null
          paid_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          refunded_cents?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          subscription_id?: string | null
          appointment_id?: string | null
          payer_user_id?: string
          amount_cents?: number
          currency?: string
          status?: Database["public"]["Enums"]["payment_status"]
          method?: Database["public"]["Enums"]["payment_method"] | null
          provider?: string | null
          provider_payment_id?: string | null
          provider_payload?: Json | null
          paid_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          refunded_cents?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_appointment_id_fkey"
            columns: ["appointment_id"]
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payer_user_id_fkey"
            columns: ["payer_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_subscription_id_fkey"
            columns: ["subscription_id"]
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          }
        ]
      }
      plans: {
        Row: {
          id: number
          key: string
          name: string
          description: string | null
          price_cents: number
          currency: string
          billing_interval: Database["public"]["Enums"]["billing_interval"]
          trial_days: number
          max_consulting_rooms: number | null
          max_photos: number | null
          max_services: number | null
          features: Json
          display_order: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: number
          key: string
          name: string
          description?: string | null
          price_cents: number
          currency?: string
          billing_interval?: Database["public"]["Enums"]["billing_interval"]
          trial_days?: number
          max_consulting_rooms?: number | null
          max_photos?: number | null
          max_services?: number | null
          features?: Json
          display_order?: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: number
          key?: string
          name?: string
          description?: string | null
          price_cents?: number
          currency?: string
          billing_interval?: Database["public"]["Enums"]["billing_interval"]
          trial_days?: number
          max_consulting_rooms?: number | null
          max_photos?: number | null
          max_services?: number | null
          features?: Json
          display_order?: number
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      prescription_items: {
        Row: {
          id: string
          prescription_id: string
          drug_name: string
          presentation: string | null
          dosage: string | null
          frequency: string | null
          duration: string | null
          quantity: string | null
          notes: string | null
          display_order: number
        }
        Insert: {
          id?: string
          prescription_id: string
          drug_name: string
          presentation?: string | null
          dosage?: string | null
          frequency?: string | null
          duration?: string | null
          quantity?: string | null
          notes?: string | null
          display_order?: number
        }
        Update: {
          id?: string
          prescription_id?: string
          drug_name?: string
          presentation?: string | null
          dosage?: string | null
          frequency?: string | null
          duration?: string | null
          quantity?: string | null
          notes?: string | null
          display_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "prescription_items_prescription_id_fkey"
            columns: ["prescription_id"]
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          }
        ]
      }
      prescriptions: {
        Row: {
          id: string
          medical_record_id: string | null
          appointment_id: string | null
          patient_id: string
          doctor_id: string
          folio: string
          instructions: string | null
          diagnosis: string | null
          issued_at: string
          valid_until: string | null
          pdf_url: string | null
          pdf_sha256: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          medical_record_id?: string | null
          appointment_id?: string | null
          patient_id: string
          doctor_id: string
          folio?: string
          instructions?: string | null
          diagnosis?: string | null
          issued_at?: string
          valid_until?: string | null
          pdf_url?: string | null
          pdf_sha256?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          medical_record_id?: string | null
          appointment_id?: string | null
          patient_id?: string
          doctor_id?: string
          folio?: string
          instructions?: string | null
          diagnosis?: string | null
          issued_at?: string
          valid_until?: string | null
          pdf_url?: string | null
          pdf_sha256?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_appointment_id_fkey"
            columns: ["appointment_id"]
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_medical_record_id_fkey"
            columns: ["medical_record_id"]
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            referencedRelation: "patients"
            referencedColumns: ["id"]
          }
        ]
      }
      review_reports: {
        Row: {
          id: string
          review_id: string
          reported_by: string
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          review_id: string
          reported_by: string
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          review_id?: string
          reported_by?: string
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_reports_reported_by_fkey"
            columns: ["reported_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_reports_review_id_fkey"
            columns: ["review_id"]
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          }
        ]
      }
      reviews: {
        Row: {
          id: string
          appointment_id: string
          patient_id: string
          doctor_id: string
          rating: number
          comment: string | null
          rating_punctuality: number | null
          rating_attention: number | null
          rating_facilities: number | null
          status: Database["public"]["Enums"]["review_status"]
          is_anonymous: boolean
          doctor_reply: string | null
          doctor_replied_at: string | null
          moderated_by: string | null
          moderated_at: string | null
          moderation_reason: string | null
          created_at: string
          updated_at: string
          author_display_name: string | null
        }
        Insert: {
          id?: string
          appointment_id: string
          patient_id: string
          doctor_id: string
          rating: number
          comment?: string | null
          rating_punctuality?: number | null
          rating_attention?: number | null
          rating_facilities?: number | null
          status?: Database["public"]["Enums"]["review_status"]
          is_anonymous?: boolean
          doctor_reply?: string | null
          doctor_replied_at?: string | null
          moderated_by?: string | null
          moderated_at?: string | null
          moderation_reason?: string | null
          created_at?: string
          updated_at?: string
          author_display_name?: string | null
        }
        Update: {
          id?: string
          appointment_id?: string
          patient_id?: string
          doctor_id?: string
          rating?: number
          comment?: string | null
          rating_punctuality?: number | null
          rating_attention?: number | null
          rating_facilities?: number | null
          status?: Database["public"]["Enums"]["review_status"]
          is_anonymous?: boolean
          doctor_reply?: string | null
          doctor_replied_at?: string | null
          moderated_by?: string | null
          moderated_at?: string | null
          moderation_reason?: string | null
          created_at?: string
          updated_at?: string
          author_display_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_appointment_id_fkey"
            columns: ["appointment_id"]
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_moderated_by_fkey"
            columns: ["moderated_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_patient_id_fkey"
            columns: ["patient_id"]
            referencedRelation: "patients"
            referencedColumns: ["id"]
          }
        ]
      }
      roles: {
        Row: {
          id: number
          key: string
          name: string
          description: string | null
          level: number
          created_at: string
        }
        Insert: {
          id?: number
          key: string
          name: string
          description?: string | null
          level: number
          created_at?: string
        }
        Update: {
          id?: number
          key?: string
          name?: string
          description?: string | null
          level?: number
          created_at?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          value: Json
          description: string | null
          is_public: boolean
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          key: string
          value: Json
          description?: string | null
          is_public?: boolean
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          key?: string
          value?: Json
          description?: string | null
          is_public?: boolean
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      specialties: {
        Row: {
          id: number
          name: string
          slug: string
          description: string | null
          icon: string | null
          is_featured: boolean
          display_order: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: number
          name: string
          slug: string
          description?: string | null
          icon?: string | null
          is_featured?: boolean
          display_order?: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: number
          name?: string
          slug?: string
          description?: string | null
          icon?: string | null
          is_featured?: boolean
          display_order?: number
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          id: string
          doctor_id: string
          plan_id: number
          status: Database["public"]["Enums"]["subscription_status"]
          current_period_start: string
          current_period_end: string
          trial_ends_at: string | null
          cancel_at_period_end: boolean
          cancelled_at: string | null
          provider: string | null
          provider_customer_id: string | null
          provider_subscription_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          doctor_id: string
          plan_id: number
          status?: Database["public"]["Enums"]["subscription_status"]
          current_period_start?: string
          current_period_end: string
          trial_ends_at?: string | null
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          provider?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          doctor_id?: string
          plan_id?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          current_period_start?: string
          current_period_end?: string
          trial_ends_at?: string | null
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          provider?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_doctor_id_fkey"
            columns: ["doctor_id"]
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            referencedRelation: "plans"
            referencedColumns: ["id"]
          }
        ]
      }
      subspecialties: {
        Row: {
          id: number
          specialty_id: number
          name: string
          slug: string
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: number
          specialty_id: number
          name: string
          slug: string
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: number
          specialty_id?: number
          name?: string
          slug?: string
          is_active?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subspecialties_specialty_id_fkey"
            columns: ["specialty_id"]
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          }
        ]
      }
      user_roles: {
        Row: {
          user_id: string
          role_id: number
          granted_by: string | null
          granted_at: string
        }
        Insert: {
          user_id: string
          role_id: number
          granted_by?: string | null
          granted_at?: string
        }
        Update: {
          user_id?: string
          role_id?: number
          granted_by?: string | null
          granted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      users: {
        Row: {
          id: string
          email: unknown | null
          first_name: string | null
          last_name: string | null
          full_name: string | null
          phone: string | null
          avatar_url: string | null
          locale: string
          timezone: string
          is_active: boolean
          onboarded_at: string | null
          last_login_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: unknown | null
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          avatar_url?: string | null
          locale?: string
          timezone?: string
          is_active?: boolean
          onboarded_at?: string | null
          last_login_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: unknown | null
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          avatar_url?: string | null
          locale?: string
          timezone?: string
          is_active?: boolean
          onboarded_at?: string | null
          last_login_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      working_hours: {
        Row: {
          id: string
          consulting_room_id: string
          weekday: number
          start_time: string
          end_time: string
          allows_in_person: boolean
          allows_video: boolean
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          consulting_room_id: string
          weekday: number
          start_time: string
          end_time: string
          allows_in_person?: boolean
          allows_video?: boolean
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          consulting_room_id?: string
          weekday?: number
          start_time?: string
          end_time?: string
          allows_in_person?: boolean
          allows_video?: boolean
          is_active?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "working_hours_consulting_room_id_fkey"
            columns: ["consulting_room_id"]
            referencedRelation: "consulting_rooms"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      appointment_parties: {
        Args: {
          p_appointment_id: string
        }
        Returns: {
        patient_user_id: string
        doctor_user_id: string
        doctor_label: string
        patient_label: string
        doctor_slug: string
      }[]
      }
      begin_internal_write: {
        Args: {
          [_ in never]: never
        }
        Returns: string
      }
      current_doctor_id: {
        Args: {
          [_ in never]: never
        }
        Returns: string
      }
      current_patient_id: {
        Args: {
          [_ in never]: never
        }
        Returns: string
      }
      current_role_level: {
        Args: {
          [_ in never]: never
        }
        Returns: number
      }
      doctor_is_public: {
        Args: {
          d: string
        }
        Returns: boolean
      }
      doctor_treats_patient: {
        Args: {
          p_patient_id: string
        }
        Returns: boolean
      }
      end_internal_write: {
        Args: {
          [_ in never]: never
        }
        Returns: string
      }
      format_appointment_when: {
        Args: {
          p_starts_at: string
        }
        Returns: string
      }
      get_available_slots: {
        Args: {
          p_doctor_id: string
          p_room_id: string
          p_from?: string
          p_days?: number
        }
        Returns: {
        slot_start: string
        slot_end: string
      }[]
      }
      has_role: {
        Args: {
          role_key: string
        }
        Returns: boolean
      }
      is_admin: {
        Args: {
          [_ in never]: never
        }
        Returns: boolean
      }
      is_clinical_staff: {
        Args: {
          [_ in never]: never
        }
        Returns: boolean
      }
      is_internal_write: {
        Args: {
          [_ in never]: never
        }
        Returns: boolean
      }
      is_super_admin: {
        Args: {
          [_ in never]: never
        }
        Returns: boolean
      }
      mark_all_notifications_read: {
        Args: {
          [_ in never]: never
        }
        Returns: number
      }
      mark_conversation_read: {
        Args: {
          p_conversation_id: string
        }
        Returns: string
      }
      notify: {
        Args: {
          p_user_id: string
          p_type: string
          p_title: string
          p_body?: string
          p_action_url?: string
          p_payload?: Json
        }
        Returns: string
      }
      open_conversation: {
        Args: {
          p_doctor_id: string
        }
        Returns: string
      }
      patient_age: {
        Args: {
          p: string
        }
        Returns: number
      }
      review_author_label: {
        Args: {
          p_patient_id: string
          p_anonymous: boolean
        }
        Returns: string
      }
      slugify: {
        Args: {
          value: string
        }
        Returns: string
      }
      unaccent_immutable: {
        Args: {
          value: string
        }
        Returns: string
      }
    }
    Enums: {
      appointment_modality: "in_person" | "video" | "home_visit"
      appointment_status: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled_by_patient" | "cancelled_by_doctor" | "no_show" | "rescheduled"
      audit_action: "insert" | "update" | "delete"
      availability_exception_type: "vacation" | "holiday" | "block" | "extra"
      billing_interval: "month" | "year"
      blood_type: "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-"
      doctor_status: "draft" | "pending_verification" | "verified" | "rejected" | "suspended"
      document_type: "lab_result" | "imaging" | "prescription" | "referral" | "consent" | "insurance" | "identification" | "other"
      facility_type: "clinic" | "hospital" | "laboratory"
      gender: "male" | "female" | "other" | "prefer_not_to_say"
      media_type: "image" | "video"
      notification_channel: "in_app" | "email" | "push" | "sms" | "whatsapp"
      notification_type: "appointment_created" | "appointment_confirmed" | "appointment_reminder" | "appointment_cancelled" | "appointment_rescheduled" | "message_received" | "review_received" | "review_replied" | "prescription_issued" | "document_shared" | "subscription_expiring" | "subscription_activated" | "payment_failed" | "doctor_verified" | "doctor_rejected" | "system"
      payment_method: "card" | "spei" | "oxxo" | "paypal" | "cash" | "transfer"
      payment_status: "pending" | "processing" | "succeeded" | "failed" | "refunded" | "partially_refunded"
      review_status: "pending" | "published" | "hidden" | "removed"
      subscription_status: "trialing" | "active" | "past_due" | "cancelled" | "expired" | "paused"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"]

export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"]

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"]

export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T]
