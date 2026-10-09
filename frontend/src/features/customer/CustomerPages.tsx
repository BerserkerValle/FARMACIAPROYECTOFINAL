import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiRequest } from '../../api';
import { PasswordInputComponent } from '../../components/PasswordInput';
import { useToast } from '../../components/ToastProvider';
import { validateEmail, validatePassword } from '../../lib/validation';
import type { CustomerAccount } from '../../types';

export function CustomerAuthPage({ onLogin }: { onLogin: (token: string, customer: CustomerAccount) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '', nit: '' });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const { success: showSuccess } = useToast();

  const validateForm = useCallback((): boolean => {
    let valid = true;
    if (mode === 'register') {
      if (!form.fullName.trim()) { setEmailError('El nombre completo es requerido'); valid = false; } else setEmailError(null);
    }
    const emailValidation = validateEmail(form.email);
    if (!emailValidation.valid) { setEmailError(emailValidation.error); valid = false; } else setEmailError(null);
    if (mode === 'register') {
      const pwdValidation = validatePassword(form.password);
      if (!pwdValidation.valid) { setPasswordError(pwdValidation.errors.join(', ')); valid = false; } else setPasswordError(null);
    }
    return valid;
  }, [mode, form]);

  async function submit() {
    if (!validateForm()) return;
    try {
      const path = mode === 'login' ? '/api/auth/customers/login' : '/api/auth/customers/register';
      const result = await apiRequest<{ token: string; customer: CustomerAccount }>(path, {
        method: 'POST',
        body: JSON.stringify(mode === 'login' ? { email: form.email, password: form.password } : form)
      });
      onLogin(result.token, result.customer);
      showSuccess(mode === 'login' ? '¡Bienvenido a FARMACIA FJK!' : '¡Cuenta creada exitosamente!');
    } catch { /* El error ya se muestra globalmente via toast. */ }
  }

  return (
    <div className="auth-container"><div className="auth-card-box">
      <h2>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta de cliente'}</h2>
      <p>Consulta tus pedidos y el avance de tus entregas.</p>
      {mode === 'register' && <div className="form-field"><label>Nombre completo</label><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Tu nombre completo" /></div>}
      <div className="form-field"><label>Correo electrónico</label><input type="email" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setEmailError(null); }} placeholder="correo@ejemplo.com" aria-invalid={emailError ? 'true' : 'false'} aria-describedby={emailError ? 'email-error' : undefined} />{emailError && <p id="email-error" className="form-field-error" role="alert">{emailError}</p>}</div>
      <PasswordInputComponent label="Contraseña" value={form.password} onChange={(e) => { setForm({ ...form, password: e.target.value }); setPasswordError(null); }} placeholder="Tu contraseña" required error={passwordError} showStrength={mode === 'register'} aria-invalid={passwordError ? 'true' : 'false'} aria-describedby={passwordError ? 'password-error' : undefined} />
      {passwordError && <p id="password-error" className="form-field-error" role="alert">{passwordError}</p>}
      {mode === 'register' && <div className="form-grid-2"><div className="form-field"><label>Teléfono</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="5555-4444" /></div><div className="form-field"><label>NIT o C/F</label><input value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} placeholder="1234567-8 o C/F" /></div></div>}
      <button type="button" className="btn-primary" onClick={submit}>{mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
      <button type="button" className="btn-secondary" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setPasswordError(null); setEmailError(null); }}>{mode === 'login' ? 'Crear una cuenta nueva' : 'Ya tengo una cuenta'}</button>
    </div></div>
  );
}

function CustomerLiveMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!mapElement.current) return;
    const map = L.map(mapElement.current).setView([latitude, longitude], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    L.circleMarker([latitude, longitude], { radius: 9, color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 1 }).addTo(map).bindPopup('Ubicación actual del repartidor').openPopup();
    return () => { map.remove(); };
  }, [latitude, longitude]);
  return <div ref={mapElement} style={{ width: '100%', height: '260px', borderRadius: '8px', overflow: 'hidden', marginTop: '0.75rem' }} />;
}

export function CustomerOrdersPage({ customer, customerToken, onUpdate, onLogout }: { customer: CustomerAccount; customerToken: string; onUpdate: (customer: CustomerAccount) => void; onLogout: () => void }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [status, setStatus] = useState('Cargando pedidos...');
  const [form, setForm] = useState(customer);
  const [editing, setEditing] = useState(false);

  async function loadOrders() {
    try { const data = await apiRequest<any[]>('/api/public/customer/orders', {}, customerToken); setOrders(data); setStatus(data.length ? '' : 'Aún no tienes pedidos de domicilio'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'No se pudieron cargar tus pedidos'); }
  }
  useEffect(() => { loadOrders(); const timer = window.setInterval(loadOrders, 15000); return () => window.clearInterval(timer); }, [customer.customerId, customerToken]);
  async function saveProfile() {
    try {
      const result = await apiRequest<{ customer: CustomerAccount }>('/api/auth/customers/me', { method: 'PUT', body: JSON.stringify({ fullName: form.fullName, phone: form.phone, nit: form.nit, address: form.address }) }, customerToken);
      onUpdate(result.customer); setForm(result.customer); setEditing(false); setStatus('Datos actualizados correctamente.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'No se pudieron actualizar tus datos'); }
  }
  return <div className="internal-page-container"><div className="panel-card">
    <div className="panel-head"><h2>Mis pedidos y entregas</h2><span className="pill-tag">Actualización automática</span></div>
    <div className="panel-card" style={{ marginBottom: '1rem' }}><div className="panel-head"><h3>Mi información</h3><div style={{ display: 'flex', gap: '0.5rem' }}><button type="button" className="btn-secondary" onClick={() => setEditing(!editing)}>{editing ? 'Cancelar' : 'Editar datos'}</button><button type="button" className="btn-secondary" onClick={onLogout}>Cerrar sesión</button></div></div>
      {editing ? <div className="form-grid-2"><div className="form-field"><label>Nombre completo</label><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div><div className="form-field"><label>Correo</label><input value={form.email} disabled /></div><div className="form-field"><label>Teléfono</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div><div className="form-field"><label>NIT o C/F</label><input value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} /></div><div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Dirección principal</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Calle, municipio, número de casa" /></div><button type="button" className="btn-primary" onClick={saveProfile}>Guardar datos</button></div> : <p>{customer.fullName} · {customer.phone} · {customer.address || 'Sin dirección guardada'}</p>}
    </div>
    {status && <div className="checkout-status-msg">{status}</div>}<div className="item-list-stack">{orders.map((order) => <div key={order.code} className="compact-list-row"><div><strong>{order.code}</strong><p>{order.address}</p><small>Estado: {order.status} · Última actualización: {new Date(order.updatedAt).toLocaleString('es-GT')}</small>{order.latitude && order.longitude && <CustomerLiveMap latitude={Number(order.latitude)} longitude={Number(order.longitude)} />}</div>{order.latitude && order.longitude && <span className="pill-tag">Repartidor en ruta</span>}</div>)}</div>
  </div></div>;
}
