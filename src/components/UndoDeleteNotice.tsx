import { useEffect, useRef } from 'react';
import { Alert, Button } from 'react-bootstrap';

// How long "Deleted <client>" can be undone before the client is deleted
const UNDO_DELETE_MS = 6000;

// "Deleted <client>" with Undo; the client is deleted when it times out
export default function UndoDeleteNotice(props: { name: string; onClose: (undo: boolean) => void }) {
  const onCloseRef = useRef(props.onClose);
  useEffect(() => {
    onCloseRef.current = props.onClose;
  });

  useEffect(() => {
    const timer = setTimeout(() => onCloseRef.current(false), UNDO_DELETE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Alert variant="dark" className="d-flex align-items-center justify-content-between gap-3 py-2 pe-2">
      <span className="text-truncate">Deleted {props.name}</span>
      <Button variant="link" size="sm" className="fw-semibold text-decoration-none" onClick={() => props.onClose(true)}>
        Undo
      </Button>
    </Alert>
  );
}
