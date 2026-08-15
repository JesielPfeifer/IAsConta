import { useState, useEffect, useCallback } from 'react';
import { QrCode, CheckCircle2, Loader2, RefreshCw, Power } from 'lucide-react';
import { api } from '../api/client';

interface InstanceState {
  connected: boolean;
  state?: string;
  instanceName?: string | null;
  phone?: string;
}

export default function WhatsAppInstanceCard() {
  const [connected, setConnected] = useState(false);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Cria/regenera o QR (instância única por usuário — sem número)
  const fetchQRCode = useCallback(async () => {
    try {
      setError('');
      setLoading(true);
      const data = await api('/api/whatsapp-instance', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (data.connected) {
        setConnected(true);
        setQrcode(null);
      } else if (data.qrCode) {
        setQrcode(data.qrCode.startsWith('data:') ? data.qrCode : `data:image/png;base64,${data.qrCode}`);
        setConnected(false);
      }
      if (data.instanceName) setInstanceName(data.instanceName);
    } catch {
      setError('Nao foi possivel conectar ao servidor');
    } finally {
      setLoading(false);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const data = await api('/api/whatsapp-instance/state');
      setConnected(!!data.connected);
      setInstanceName(data.instanceName || null);
      if (data.connected) setQrcode(null);
    } catch {}
  }, []);

  const disconnect = async () => {
    try {
      setLoading(true);
      await api('/api/whatsapp-instance', { method: 'DELETE' });
      setConnected(false);
      setQrcode(null);
      fetchQRCode();
    } catch {
      setError('Erro ao desconectar');
      setLoading(false);
    }
  };

  useEffect(() => {
    // Ao abrir: verifica estado; se não conectado, gera o QR
    checkStatus().then(() => {
      setLoading(false);
    });
    // Se não conectado após checar, gera o QR automaticamente
    // (polling do estado)
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  // Gera QR automaticamente quando não conectado e sem QR
  useEffect(() => {
    if (!loading && !connected && !qrcode && !error) {
      fetchQRCode();
    }
  }, [loading, connected, qrcode, error, fetchQRCode]);

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          <h2 className="text-lg font-semibold text-white">
            {connected ? 'Conectado' : 'Desconectado'}
          </h2>
        </div>
        {connected && (
          <button
            onClick={disconnect}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-sm transition-colors"
          >
            <Power className="w-4 h-4" />Desconectar
          </button>
        )}
      </div>

      {instanceName && (
        <p className="text-xs text-gray-500 -mt-3">
          Instância: <code className="text-emerald-400">{instanceName}</code>
        </p>
      )}

      {loading && (
        <div className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
          <p className="text-gray-400 text-sm">Carregando...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm text-center">
          {error}
          <button onClick={() => { setLoading(true); fetchQRCode(); }} className="ml-3 underline hover:text-red-300">
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && !connected && qrcode && (
        <div className="flex flex-col items-center gap-6 py-6">
          <div className="bg-white p-4 rounded-2xl shadow-xl">
            <img src={qrcode} alt="QR Code WhatsApp" className="w-64 h-64" />
          </div>
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-gray-300">
              <QrCode className="w-5 h-5 text-emerald-400" />
              <p className="text-sm font-medium">Escaneie o QR Code</p>
            </div>
            <ol className="text-xs text-gray-500 space-y-1 max-w-sm mx-auto">
              <li>1. Abra o WhatsApp no celular</li>
              <li>2. Va em Configuracoes &gt; Dispositivos conectados</li>
              <li>3. Toque em &quot;Conectar dispositivo&quot;</li>
              <li>4. Escaneie o QR Code acima</li>
            </ol>
            <button
              onClick={() => { setLoading(true); fetchQRCode(); }}
              className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 mt-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />Gerar novo QR Code
            </button>
          </div>
        </div>
      )}

      {!loading && !error && !connected && !qrcode && !instanceName && (
        <div className="flex flex-col items-center gap-3 py-12 text-gray-400">
          <p className="text-sm">Nao foi possivel gerar o QR Code.</p>
          <button
            onClick={() => { setLoading(true); fetchQRCode(); }}
            className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 text-sm"
          >
            <RefreshCw className="w-4 h-4" />Tentar novamente
          </button>
        </div>
      )}

      {connected && (
        <div className="flex flex-col items-center gap-4 py-8">
          <CheckCircle2 className="w-16 h-16 text-emerald-400" />
          <p className="text-white text-lg font-medium">WhatsApp conectado!</p>
          <p className="text-gray-400 text-sm">
            Envie mensagens com <code className="bg-gray-800 px-1.5 py-0.5 rounded text-emerald-400">@contas</code> no grupo ou privado.
          </p>
        </div>
      )}
    </section>
  );
}
