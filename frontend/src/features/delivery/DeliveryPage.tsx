import { useEffect, useState } from 'react';
import { apiRequest, uploadPrescription } from '../../api';
import { money } from '../../lib/catalog';

// Diccionario de ubicaciones de partida por sucursal para Google Maps
const branchOrigins: Record<string, string> = {
  'Antigua Central': 'Paseo Antigua, Entrada o parqueo',
  'Ciudad Vieja': 'Vista a los Volcanes, Entrada o parqueo',
  Jocotenango: 'Plaza Jocotenango, Entrada o parqueo',
  Pastores: 'Parqueo Pastores, Entrada o parqueo',
  'San Lucas': 'Parqueo San Lucas, Entrada o parqueo',
  'Santa María': 'Parqueo Santa María, Entrada o parqueo',
  'Dueñas': 'Parqueo Dueñas, Entrada o parqueo',
  Xela: 'Interplaza Xela, Entrada o parqueo',
};

function GoogleMapLink({ origin, destination }: { origin: string; destination: string }) {
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  return (
    <a className="btn-primary" href={googleMapsUrl} target="_blank" rel="noreferrer" style={{ width: '100%' }}>
      Ver ruta en Google Maps
    </a>
  );
}

function getBranchOrigin(branchName: string): string | null {
  // Buscar coincidencia exacta o parcial (case-insensitive)
  const originKey = Object.keys(branchOrigins).find(
    (key) =>
      key.toLowerCase() === branchName.toLowerCase() ||
      key.toLowerCase().includes(branchName.toLowerCase()) ||
      branchName.toLowerCase().includes(key.toLowerCase())
  );
  return originKey ? branchOrigins[originKey] : null;
}

export function DeliveryPage({ token }: { token: string | null }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [status, setStatus] = useState('');
  const [recipe, setRecipe] = useState<File | null>(null);
  const [orderId, setOrderId] = useState('');

  async function loadRoute() {
    if (!token) return;
    const data = await apiRequest<any[]>(`/api/pos/deliveries?branchId=1`, {}, token);
    setOrders(data);
  }
  useEffect(() => {
    loadRoute().catch((error) => setStatus(error.message));
  }, [token]);

  async function uploadProof() {
    try {
      if (!recipe) throw new Error('Selecciona la foto de la receta entregada');
      const parsedOrderId = Number(orderId);
      if (!Number.isInteger(parsedOrderId) || parsedOrderId <= 0) {
        throw new Error('Ingresa un ID de orden válido (número entero positivo)');
      }
      const result = await uploadPrescription(recipe, parsedOrderId, 'delivery', token);
      setStatus(`Evidencia subida correctamente: ${result.url}`);
      loadRoute();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error al subir evidencia');
    }
  }
  async function updateDeliveryLocation(id: number, nextStatus = 'IN_ROUTE') {
    if (!token || !navigator.geolocation) {
      setStatus('Este dispositivo no permite compartir ubicación');
      return;
    }
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        await apiRequest(`/api/pos/deliveries/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: nextStatus,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
        }, token);
        setStatus(nextStatus === 'DELIVERED' ? 'Entrega marcada como completada.' : 'Ubicación compartida. El cliente ya puede verla.');
        loadRoute();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'No se pudo actualizar la entrega');
      }
    }, () => setStatus('Debes permitir la ubicación para iniciar la entrega'));
  }

  const selectedOrigin = selectedOrder?.branch ? getBranchOrigin(selectedOrder.branch.name) : null;

  return (
    <div className="internal-page-container">
      <div className="two-col-grid">
        <div className="panel-card">
          <div className="panel-head">
            <h2>Hoja de Ruta de Reparto</h2>
            <span className="pill-tag">{orders.length} entregas</span>
          </div>
          <div className="item-list-stack">
            {orders.map((order, idx) => (
              <button
                key={order.id}
                type="button"
                className="route-row"
                onClick={() => setSelectedOrder(order)}
                style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer' }}
              >
                <div className="route-num">{idx + 1}</div>
                <div>
                  <strong>{order.code}</strong>
                  <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                    {order.customer?.name ?? 'Cliente'} · {order.branch?.name}
                  </p>
                  <small>{order.address || 'Sin dirección registrada'}</small>
                  <small>{money(order.total)} · {order.status}</small>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }} onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="btn-secondary" onClick={() => setSelectedOrder(order)}>
                      Ver ruta
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => updateDeliveryLocation(order.id)}>
                      Iniciar / actualizar ruta
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => updateDeliveryLocation(order.id, 'DELIVERED')}>
                      Marcar entregado
                    </button>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
        {selectedOrder && (
          <div className="panel-card">
            <div className="panel-head">
              <h2>Ruta de entrega {selectedOrder.code}</h2>
              <button type="button" className="btn-secondary" onClick={() => setSelectedOrder(null)}>
                Cerrar
              </button>
            </div>
            <p>
              <strong>Sale de:</strong> {selectedOrder.branch?.name ?? 'Sucursal asignada'}
            </p>
            <p>
              <strong>Dirección:</strong> {selectedOrder.address || 'No registrada'}
            </p>
            {selectedOrigin ? (
              <GoogleMapLink origin={selectedOrigin} destination={selectedOrder.address || ''} />
            ) : (
              <p className="checkout-status-msg">
                Esta orden no tiene una sucursal reconocida para la ruta de Google Maps.
              </p>
            )}
            {selectedOrder.address ? (
              <p>
                <strong>Dirección del cliente:</strong> {selectedOrder.address}
              </p>
            ) : null}
          </div>
        )}
        <div className="panel-card">
          <div className="panel-head">
            <h2>Evidencia de Entrega</h2>
            <span className="pill-tag">Cargar Receta</span>
          </div>
          <div className="form-field">
            <label>ID de Orden</label>
            <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Ej. 1" />
          </div>
          <div className="form-field">
            <label>Foto de la Receta Firmada</label>
            <label className="prescription-dropzone">
              <span>Imagen</span>
              <span>{recipe ? recipe.name : 'Tomar foto o elegir imagen...'}</span>
              <input type="file" accept="image/*" onChange={(e) => setRecipe(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <button type="button" className="btn-primary" onClick={uploadProof}>
            Cargar y Validar Entrega
          </button>
          {status && <div className="checkout-status-msg">{status}</div>}
        </div>
      </div>
    </div>
  );
}

export default DeliveryPage;