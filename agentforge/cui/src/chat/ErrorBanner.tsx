import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

/**
 * §9 / G2-MVP-63 — amber inline note that auto-fades after 4 s.
 */
export function ErrorBanner(props: { readonly message: string; readonly onDismiss?: () => void }): ReactElement | null {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      props.onDismiss?.();
    }, 4000);
    return () => clearTimeout(t);
  }, [props]);

  if (!visible) {
    return null;
  }

  return (
    <div role="status" data-testid="error-banner" className="agentforge-cui__error-banner" style={{ background: '#FFF7E6', color: '#7A4F01', border: '1px solid #F5C97B', padding: '0.5rem 0.75rem', borderRadius: 4, fontSize: '0.875rem' }}>
      {props.message}
    </div>
  );
}
