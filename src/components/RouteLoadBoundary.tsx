import { Component, type ReactNode } from 'react';
import { PageLoadError } from '@/components/PageLoadError';


export class RouteLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <PageLoadError /> : this.props.children; }
}
