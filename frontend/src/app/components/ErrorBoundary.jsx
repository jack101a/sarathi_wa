import React, { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: '#f43f5e', fontFamily: 'monospace' }}>
          <h2>Something went wrong</h2>
          <pre style={{ fontSize: '0.8rem', opacity: 0.7 }}>{this.state.error?.message}</pre>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
