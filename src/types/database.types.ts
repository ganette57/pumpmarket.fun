export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      markets: {
        Row: {
          id: number
          market_address: string
          question: string
          description: string | null
          category: string | null
          image_url: string | null
          end_date: string
          creator: string
          social_links: Json | null
          yes_supply: number
          no_supply: number
          total_volume: number
          resolved: boolean
          resolution_result: boolean | null
          created_at: string
        }
        Insert: {
          id?: number
          market_address: string
          question: string
          description?: string | null
          category?: string | null
          image_url?: string | null
          end_date: string
          creator: string
          social_links?: Json | null
          yes_supply?: number
          no_supply?: number
          total_volume?: number
          resolved?: boolean
          resolution_result?: boolean | null
          created_at?: string
        }
        Update: {
          id?: number
          market_address?: string
          question?: string
          description?: string | null
          category?: string | null
          image_url?: string | null
          end_date?: string
          creator?: string
          social_links?: Json | null
          yes_supply?: number
          no_supply?: number
          total_volume?: number
          resolved?: boolean
          resolution_result?: boolean | null
          created_at?: string
        }
      }
      comments: {
        Row: {
          id: number
          market_id: number
          user_address: string
          content: string
          created_at: string
        }
        Insert: {
          id?: number
          market_id: number
          user_address: string
          content: string
          created_at?: string
        }
        Update: {
          id?: number
          market_id?: number
          user_address?: string
          content?: string
          created_at?: string
        }
      }
      bookmarks: {
        Row: {
          id: number
          user_address: string
          market_id: number
          created_at: string
        }
        Insert: {
          id?: number
          user_address: string
          market_id: number
          created_at?: string
        }
        Update: {
          id?: number
          user_address?: string
          market_id?: number
          created_at?: string
        }
      }
      transactions: {
        Row: {
          id: number
          market_id: number
          user_address: string
          transaction_type: 'buy' | 'sell'
          outcome: 'yes' | 'no'
          amount: number
          price: number
          tx_signature: string
          created_at: string
        }
        Insert: {
          id?: number
          market_id: number
          user_address: string
          transaction_type: 'buy' | 'sell'
          outcome: 'yes' | 'no'
          amount: number
          price: number
          tx_signature: string
          created_at?: string
        }
        Update: {
          id?: number
          market_id?: number
          user_address?: string
          transaction_type?: 'buy' | 'sell'
          outcome?: 'yes' | 'no'
          amount?: number
          price?: number
          tx_signature?: string
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}

export type Market = Database['public']['Tables']['markets']['Row']
export type MarketInsert = Database['public']['Tables']['markets']['Insert']
export type MarketUpdate = Database['public']['Tables']['markets']['Update']

export type Comment = Database['public']['Tables']['comments']['Row']
export type CommentInsert = Database['public']['Tables']['comments']['Insert']
export type CommentUpdate = Database['public']['Tables']['comments']['Update']

export type Bookmark = Database['public']['Tables']['bookmarks']['Row']
export type BookmarkInsert = Database['public']['Tables']['bookmarks']['Insert']
export type BookmarkUpdate = Database['public']['Tables']['bookmarks']['Update']

export type Transaction = Database['public']['Tables']['transactions']['Row']
export type TransactionInsert = Database['public']['Tables']['transactions']['Insert']
export type TransactionUpdate = Database['public']['Tables']['transactions']['Update']
