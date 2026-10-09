import type { ReactNode } from 'react';
import { Button, Modal } from 'react-bootstrap';
import type { LucideIcon } from 'lucide-react';

type DialogProps = {
  show: boolean;
  id: string;
  title: string;
  icon: LucideIcon;
  // Called with true for OK and false for Cancel, Escape or the close button
  onClose: (apply: boolean) => void;
  // Shown at the start of the footer, before Cancel and OK
  footerStart?: ReactNode;
  okLabel?: string;
  okDisabled?: boolean;
  // Added to the modal, next to sw-dialog
  className?: string;
  children: ReactNode;
};

// A modal with a title, a body and Cancel/OK, so all
// dialogs share the same layout and spacing
export default function Dialog(props: DialogProps) {
  const Icon = props.icon;
  return (
    <Modal
      show={props.show}
      onHide={() => props.onClose(false)}
      centered
      scrollable
      className={'sw-dialog' + (props.className ? ' ' + props.className : '')}
      aria-labelledby={props.id + '-title'}
    >
      <Modal.Header closeButton>
        <span className="dialog-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <Modal.Title id={props.id + '-title'} as="h5">
          {props.title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>{props.children}</Modal.Body>
      <Modal.Footer>
        {props.footerStart}
        <div className="d-flex gap-2 ms-auto">
          <Button variant="outline-secondary" onClick={() => props.onClose(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={props.okDisabled} onClick={() => props.onClose(true)}>
            {props.okLabel ?? 'OK'}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
