import { useState, type FormEvent } from 'react';
import { apiRequest } from '../../api';
import { PasswordInputComponent } from '../../components/PasswordInput';
import { useToast } from '../../components/ToastProvider';
import type { EmployeeProfile } from '../../types';

export default function LoginPage({ onLogin }: { onLogin: (token: string, profile: EmployeeProfile) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { success: showSuccess } = useToast();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await apiRequest<{ token: string; employee: EmployeeProfile }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ correo_corporativo: email, contrasena: password })
      });
      onLogin(result.token, result.employee);
      showSuccess('¡Bienvenido al sistema de FARMACIA FJK!');
    } catch {
      // El error se muestra mediante el toast global.
    }
  }
  return <div className="auth-container"><form className="auth-card-box" onSubmit={submit}><h2>Acceso Colaborador</h2><p>Ingreso a POS, Inventarios, Reparto y Administración.</p><div className="form-field"><label htmlFor="employee-email">Correo Corporativo</label><input id="employee-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="correo@farmaciafjk.com" required /></div><PasswordInputComponent label="Contraseña" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contraseña" required /><button type="submit" className="btn-primary">Entrar al Sistema</button></form></div>;
}
