import { Component } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[20rem] gap-4 text-center p-8">
        <AlertTriangle className="w-10 h-10 text-yellow-500" />
        <div>
          <p className="text-sm font-semibold text-gray-200 mb-1">Something went wrong rendering this page</p>
          <p className="text-xs text-gray-500 font-mono">{this.state.error.message}</p>
        </div>
        <button
          className="btn-ghost text-xs gap-1.5"
          onClick={() => this.setState({ error: null })}
        >
          <RefreshCw className="w-3.5 h-3.5" /> Try again
        </button>
      </div>
    )
  }
}
