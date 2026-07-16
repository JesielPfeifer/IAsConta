import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Wallet2, Mail, Lock, User, DollarSign, ArrowRight, UserPlus, LogIn } from 'lucide-react';

export default function Login() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [salary, setSalary] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await register(email, password, name, salary ? parseFloat(salary) : undefined);
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao autenticar');
    } finally {
      setLoading(false);
    }
  }

  function handleToggle() {
    setIsRegister(!isRegister);
    setError('');
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-gray-950 via-gray-900 to-emerald-950/20">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-xl shadow-emerald-500/25 mb-4">
            <Wallet2 className="w-7 h-7 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Contas</h1>
          <p className="text-gray-400 text-sm mt-1">Gestao financeira pessoal</p>
        </div>

        <div className="rounded-2xl bg-gray-900/50 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/40 overflow-hidden">
          <div className="px-7 pt-7 pb-2">
            <h2 className="text-xl font-semibold text-white text-center">
              {isRegister ? 'Criar Conta' : 'Entrar'}
            </h2>
            <p className="text-center text-sm text-gray-500 mt-1">
              {isRegister ? 'Comece a controlar suas financas' : 'Bem-vindo de volta'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="px-7 py-5 space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-red-400 text-sm">
                {error}
              </div>
            )}

            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">Nome</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full bg-white/[0.03] border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all duration-200"
                    placeholder="Seu nome"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-white/[0.03] border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all duration-200"
                  placeholder="seu@email.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all duration-200"
                  placeholder="Minimo 6 caracteres"
                />
              </div>
            </div>

            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">Salario (opcional)</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="number"
                    step="0.01"
                    value={salary}
                    onChange={(e) => setSalary(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all duration-200"
                    placeholder="Renda mensal"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 disabled:hover:from-emerald-600 disabled:hover:to-emerald-500 text-white py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 mt-2"
            >
              {loading ? (
                'Aguarde...'
              ) : (
                <>
                  {isRegister ? (
                    <>
                      <UserPlus className="w-4 h-4" />
                      Criar Conta
                    </>
                  ) : (
                    <>
                      <LogIn className="w-4 h-4" />
                      Entrar
                    </>
                  )}
                </>
              )}
            </button>

            <div className="pt-2 text-center text-sm text-gray-400">
              {isRegister ? 'Ja tem conta?' : 'Novo por aqui?'}{' '}
              <button
                type="button"
                onClick={handleToggle}
                className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-medium transition-colors duration-200"
              >
                {isRegister ? 'Entrar' : 'Criar Conta'}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          Contas - Gestao financeira para casais
        </p>
      </div>
    </div>
  );
}
