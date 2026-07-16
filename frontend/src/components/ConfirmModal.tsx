import { X, AlertTriangle } from 'lucide-react';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onCancel} className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <p className="text-sm text-gray-300 pt-2">{message}</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={onCancel} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2.5 rounded-lg text-sm transition-colors">
              {cancelLabel}
            </button>
            <button onClick={onConfirm} className="flex-1 bg-red-600 hover:bg-red-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}