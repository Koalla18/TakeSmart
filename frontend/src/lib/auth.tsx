import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface AuthContextType {
  token: string | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

const TOKEN_KEY = 'takesmart_admin_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY)
  })

  const isAuthenticated = !!token

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await fetch('http://localhost:8000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!response.ok) {
        return false
      }

      const data = await response.json()
      const newToken = data.access_token
      localStorage.setItem(TOKEN_KEY, newToken)
      setToken(newToken)
      return true
    } catch (error) {
      console.error('Login error:', error)
      return false
    }
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }

  // Verify token on mount
  useEffect(() => {
    if (token) {
      fetch('http://localhost:8000/api/auth/verify', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (!res.ok) {
            logout()
          }
        })
        .catch(() => logout())
    }
  }, [token])

  return (
    <AuthContext.Provider value={{ token, isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

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
