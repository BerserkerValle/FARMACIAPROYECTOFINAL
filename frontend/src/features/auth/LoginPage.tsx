import { useState } from 'react';
import { apiRequest } from '../../api';
import { PasswordInputComponent } from '../../components/PasswordInput';
import { useToast } from '../../components/ToastProvider';
import type { EmployeeProfile } from '../../types';

export default function LoginPage({ onLogin, onSuccess }: { onLogin: (token: string, profile: EmployeeProfile) => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('admin@derkas.com');
  const [password, setPassword] = useState('Admin123*');
  const { success: showSuccess } = useToast();
  async function submit() { try { const result = await apiRequest<{ token: string; employee: EmployeeProfile }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ correo_corporativo: email, contrasena: password }) }); onLogin(result.token, result.employee); onSuccess(); showSuccess('¡Bienvenido al sistema de FARMACIA FJK!'); } catch { /* El error se muestra mediante el toast global. */ } }
  return <div className="auth-container"><div className="auth-card-box"><h2>Acceso Colaborador</h2><p>Ingreso a POS, Inventarios, Reparto y Administración.</p><div className="form-field"><label>Correo Corporativo</label><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="correo@farmaciafjk.com" /></div><PasswordInputComponent label="Contraseña" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contraseña" required /><button type="button" className="btn-primary" onClick={submit}>Entrar al Sistema</button></div></div>;
}
