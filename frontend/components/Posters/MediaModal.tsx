type MediaModalProps = {
  onClose: () => void;
  children: React.ReactNode;
};

export default function MediaModal({ onClose, children }: MediaModalProps) {
  return (
    <div className="gallery-popup active" onClick={onClose}>
      <span className="gallery-popup-close" onClick={onClose}>
        &times;
      </span>
      <div
        className="gallery-popup-content media-modal-content"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
