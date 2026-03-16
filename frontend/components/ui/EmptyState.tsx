type EmptyStateProps = {
  title?: string;
  description?: string;
  children?: React.ReactNode;
};

export default function EmptyState({
  title,
  description,
  children,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      {children}
      {title ? <h2>{title}</h2> : null}
      {description ? <p>{description}</p> : null}
    </div>
  );
}
