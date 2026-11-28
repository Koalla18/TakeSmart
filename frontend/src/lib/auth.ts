import { createContext, useContext } from 'react'
import { TOKEN_KEY } from './adminSession'
interface AuthContextType {
  token: string | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
}

export const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Helper for authenticated API calls
export function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}
