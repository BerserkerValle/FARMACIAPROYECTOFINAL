import { useEffect, useRef, useState } from 'react';
import { apiRequest, uploadPrescription } from '../../api';
import { money } from '../../lib/catalog';
import { getDeliveryOrigin, getGoogleDirectionsUrl } from '../../lib/deliveryLocations';
import type { Branch } from '../../types';

function GoogleMapLink({ origin, destination }: { origin: string; destination: string }) {
  const googleMapsUrl = getGoogleDirectionsUrl(origin, destination);
  return (
    <a className="btn-primary" href={googleMapsUrl} target="_blank" rel="noreferrer" style={{ width: '100%' }}>
      Ver ruta en Google Maps
    </a>
  );
}

function getDeliveryCoordinates(order: any): string | null {
  const rawLatitude = order.deliveryLatitude ?? order.latitude;
  const rawLongitude = order.deliveryLongitude ?? order.longitude;
  if (rawLatitude == null || rawLongitude == null || rawLatitude === '' || rawLongitude === '') return null;
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return `${latitude},${longitude}`;
}

export function DeliveryPage({ token, role, branchId }: { token: string | null; role?: string; branchId?: number | null }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [status, setStatus] = useState('');
  const [sharingLocation, setSharingLocation] = useState(false);
  const [recipe, setRecipe] = useState<File | null>(null);
  const [orderId, setOrderId] = useState('');
  const locationWatchId = useRef<number | null>(null);
  const locationWatchOrderId = useRef<number | null>(null);
  const lastLocationSentAt = useRef(0);
  const locationRequestInFlight = useRef(false);

  function stopLocationSharing(updateState = true) {
    if (locationWatchId.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatchId.current);
      locationWatchId.current = null;
    }
    locationWatchOrderId.current = null;
    if (updateState) setSharingLocation(false);
  }

  useEffect(() => () => stopLocationSharing(false), []);

  async function loadRoute() {
    if (!token) return;
    const branches = await apiRequest<Branch[]>('/api/public/branches');
    const isSupervisor = role === 'Administrador' || role === 'Gerente';
    const routeBranches = isSupervisor
      ? branches
      : branches.filter((branch) => branch.id === branchId);
    if (routeBranches.length === 0) {
      setOrders([]);
      setStatus(isSupervisor
        ? 'No hay sucursales disponibles para consultar entregas.'
        : 'El usuario no tiene una sucursal asignada para consultar las entregas.');
      return;
    }
    const routesByBranch = await Promise.all(routeBranches.map(async (branch) => {
      const deliveries = await apiRequest<any[]>(`/api/pos/deliveries?branchId=${branch.id}`, {}, token);
      return deliveries.map((delivery) => ({
        ...delivery,
        branch: {
          ...branch,
          name: delivery.branchName || branch.name
        }
      }));
    }));
    setOrders(routesByBranch.flat());
    setStatus('');
  }
  useEffect(() => {
    loadRoute().catch((error) => setStatus(error.message));
  }, [token, role, branchId]);

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
    if (nextStatus === 'DELIVERED') {
      stopLocationSharing();
      try {
        await apiRequest(`/api/pos/deliveries/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus }),
        }, token);
        setStatus('Entrega marcada como completada.');
        await loadRoute();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'No se pudo actualizar la entrega');
      }
      return;
    }

    stopLocationSharing();
    lastLocationSentAt.current = 0;
    locationRequestInFlight.current = false;
    setStatus('Esperando ubicación GPS para iniciar el seguimiento...');
    try {
      await apiRequest(`/api/pos/deliveries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      }, token);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo iniciar el seguimiento');
      return;
    }
    locationWatchOrderId.current = id;
    locationWatchId.current = navigator.geolocation.watchPosition(async (position) => {
      const now = Date.now();
      if (locationRequestInFlight.current || now - lastLocationSentAt.current < 10000) return;
      lastLocationSentAt.current = now;
      locationRequestInFlight.current = true;
      try {
        await apiRequest(`/api/pos/deliveries/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
        }, token);
        setStatus('Ubicación compartida. El cliente ya puede ver el avance.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'No se pudo actualizar la ubicación');
      } finally {
        locationRequestInFlight.current = false;
      }
    }, (error) => {
      setStatus(error.code === error.PERMISSION_DENIED
        ? 'Debes permitir la ubicación para iniciar la entrega.'
        : 'No se pudo obtener la ubicación GPS del dispositivo.');
      stopLocationSharing();
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    setSharingLocation(true);
  }

  const selectedOrigin = selectedOrder?.branch ? getDeliveryOrigin(selectedOrder.branch) : null;
  const selectedCoordinates = selectedOrder ? getDeliveryCoordinates(selectedOrder) : null;
  const selectedDestination = selectedCoordinates || selectedOrder?.address?.trim() || '';

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
              <article
                key={order.id}
                className="route-row"
              >
                <div className="route-num">{idx + 1}</div>
                <div className="delivery-route-content">
                  <strong>{order.code}</strong>
                  <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                    {order.customer?.name ?? order.customerName ?? 'Cliente'} · {order.branch?.name ?? order.branchName ?? `Sucursal ${order.branchId}`}
                  </p>
                  <small>{order.address?.trim() || (getDeliveryCoordinates(order) ? 'Ubicación GPS compartida por el cliente' : 'Sin dirección registrada')}</small>
                  <small>{money(Number(order.total) || 0)} · {order.status}</small>
                  <div className="delivery-route-actions">
                    <button type="button" className="btn-secondary" onClick={() => setSelectedOrder(order)}>
                      Ver ruta
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => updateDeliveryLocation(order.id)}>
                      Iniciar / actualizar GPS
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => updateDeliveryLocation(order.id, 'DELIVERED')}>
                      Marcar entregado
                    </button>
                    {sharingLocation && locationWatchOrderId.current === order.id && (
                      <button type="button" className="btn-secondary" onClick={() => { stopLocationSharing(); setStatus('Se pausó el envío de ubicación.'); }}>
                        Detener ubicación
                      </button>
                    )}
                  </div>
                </div>
              </article>
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
              <strong>Dirección:</strong> {selectedOrder.address?.trim() || (selectedCoordinates ? `Ubicación GPS del cliente (${selectedCoordinates})` : 'No registrada')}
            </p>
            {selectedOrigin && selectedDestination ? (
              <GoogleMapLink origin={selectedOrigin} destination={selectedDestination} />
            ) : (
              <p className="checkout-status-msg">
                No se pudo obtener el origen de la sucursal o el destino del cliente para crear la ruta.
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