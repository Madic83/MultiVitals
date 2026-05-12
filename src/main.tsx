import { Component } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

interface AppErrorBoundaryState {
	errorMessage: string | null
}

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
	state: AppErrorBoundaryState = {
		errorMessage: null,
	}

	static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
		return {
			errorMessage: error.message || 'Unknown runtime error',
		}
	}

	override render() {
		if (this.state.errorMessage) {
			return (
				<main
					style={{
						minHeight: '100vh',
						display: 'grid',
						placeItems: 'center',
						padding: '24px',
						fontFamily: 'Segoe UI, sans-serif',
					}}
				>
					<section
						style={{
							maxWidth: '680px',
							width: '100%',
							padding: '20px',
							borderRadius: '16px',
							background: '#ffffff',
							border: '1px solid #d6e4e8',
							boxShadow: '0 18px 36px rgba(9, 44, 52, 0.12)',
						}}
					>
						<h1 style={{ margin: '0 0 12px', fontSize: '24px' }}>Runtime error</h1>
						<p style={{ margin: 0, color: '#a1260d' }}>{this.state.errorMessage}</p>
					</section>
				</main>
			)
		}

		return this.props.children
	}
}

createRoot(document.getElementById('root')!).render(
	<AppErrorBoundary>
		<App />
	</AppErrorBoundary>,
)
