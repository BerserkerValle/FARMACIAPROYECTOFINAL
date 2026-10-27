import { useEffect, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiRequest } from '../../api';
import { money } from '../../lib/catalog';

/** Orígenes de texto por nombre de sucursal (fallback cuando no hay coordenadas). */
const branchTextOrigins: Record<string, string> = {
  'Antigua Central': 'Paseo Antigua, Entrada o parqueo',
  'Ciudad Vieja': 'Vista a los Volcanes, Entrada o parqueo',
  Jocotenango: 'Plaza Jocotenango, Entrada o parqueo',
  Pastores: 'Parqueo Pastores, Entrada o parqueo',
  'San Lucas': 'Parqueo San Lucas, Entrada o parqueo',
  'Santa María': 'Parqueo Santa María, Entrada o parqueo',
  Dueñas: 'Parqueo Dueñas, Entrada o parqueo',
  Xela: 'Interplaza Xela, Entrada o parqueo',
};

/** Componente Leaflet Map con origen y destino */
function DeliveryMap({
  originLat,
  originLng,
  destinationLat,
  destinationLng,
  courierLat,
  courierLng,
  branchName,
}: {
  originLat?: number | null;
  originLng?: number | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
  courierLat?: number | null;
  courierLng?: number | null;
  branchName?: string | null;
}) {
  const mapElementRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!mapElementRef.current) return;
    const map = L.map(mapElementRef.current).setView([14.6, -90.7], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    // Marcador de origen (sucursal)
    if (originLat !== null && originLng !== null) {
      L.marker([originLat, originLng])
        .addTo(map)
        .bindPopup(`<b>Origen: ${branchName ?? 'Sucursal'}</b>`)
        .openPopup();
    }

    // Marcador de destino (cliente)
    if (destinationLat !== null && destinationLng !== null) {
      L.marker([destinationLat, destinationLng])
        .addTo(map)
        .bindPopup('<b>Destino: Entrega al cliente</b>');
    }

    // Marcador de ubicación del repartidor (si está disponible)
    if (courierLat !== null && courierLng !== null) {
      L.marker([courierLat, courierLng], {
        icon: L.icon({
          iconUrl:
            'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          iconSize: [25, 41],
        }),
      })
        .addTo(map)
        .bindPopup('<b>Repartidor en ruta</b>');
    }

    // Línea entre origen y destino (cuando estén ambos)
    if (
      originLat !== null &&
      originLng !== null &&
      destinationLat !== null &&
      destinationLng !== null
    ) {
      L.polyline(
        [
          [originLat, originLng],
          [destinationLat, destinationLng],
        ],
        { color: 'green', weight: 4, dashArray: '5, 5' }
      ).addTo(map);
    }

    // Línea entre repartidor y destino (si el repartidor está en ruta)
    if (
      courierLat !== null &&
      courierLng !== null &&
      destinationLat !== null &&
      destinationLng !== null
    ) {
      L.polyline(
        [
          [courierLat, courierLng],
          [destinationLat, destinationLng],
        ],
        { color: 'blue', weight: 4 }
      ).addTo(map);
    }
  }, [
    originLat,
    originLng,
    destinationLat,
    destinationLng,
    courierLat,
    courierLng,
    branchName,
  ]);

  return <div ref={mapElementRef} style={{ width: '100%', height: '260px' }} />;
}

/** Determina el enlace de Google Maps si hay datos, o null */
function useGoogleMapLink(
  address: string | null,
  branchName: string | null
): JSX.Element | null {
  const originText = getBranchOrigin(branchName ?? '');
  if (!address || !originText) return null;
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
    originText
  )}&destination=${encodeURIComponent(address)}&travelmode=driving`;
  return <a className="btn-primary" href={googleMapsUrl} target="_blank" rel="noreferrer">
    Ver ruta en Google Maps
  </a>;
}

/** Obtiene el texto del origen de la sucursal */
function getBranchOrigin(branchName: string): string | null {
  if (!branchName) return null;
  const originKey = Object.keys(branchTextOrigins).find(
    (key) =>
      key.toLowerCase() === branchName.toLowerCase() ||
      key.toLowerCase().includes(branchName.toLowerCase()) ||
      branchName.toLowerCase().includes(key.toLowerCase())
  );
  return originKey ? branchTextOrigins[originKey] : null;
}

export function DeliveryPage({ token }: { token: string | null }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [status, setStatus] = useState('');
  const [recipe, setRecipe] = useState<File | null>(null);
  const [orderId, setOrderId] = useState('');
  const [mapData, setMapData] = useState({
    originLat: null as number | null,
    originLng: null as number | null,
    destinationLat: null as number | null,
    destinationLng: null as number | null,
    courierLat: null as number | null,
    courierLng: null as number | null,
    branchName: null as string | null,
  });

  async function loadRoute() {
    if (!token) return;
    const data = await apiRequest<any[]>(`/api/pos/deliveries?branchId=1`, {}, token);
    setOrders(data);

    if (data && data.length > 0) {
      const firstOrder = data[0];
      const branchName = firstOrder.branch_name ?? String(firstOrder.branchId);
      const originCoords = [
        firstOrder.branch_latitude,
        firstOrder.branch_longitude,
      ].filter(
        (v): v is number => typeof v === 'number'
      );
      const destinationCoords = [
        firstOrder.deliveryLatitude,
        firstOrder.deliveryLongitude,
      ].filter(
        (v): v is number => typeof v === 'number'
      );
      const courierCoords = [
        firstOrder.courier_latitude,
        firstOrder.courier_longitude,
      ].filter(
        (v): v is number => typeof v === 'number'
      );

      setMapData({
        originLat: originCoords[0] || null,
        originLng: originCoords[1] || null,
        destinationLat: destinationCoords[0] || null,
        destinationLng: destinationCoords[1] || null,
        courierLat: courierCoords[0] || null,
        courierLng: courierCoords[1] || null,
        branchName,
      });
    } else {
      setMapData({
        originLat: null,
        originLng: null,
        destinationLat: null,
        destinationLng: null,
        courierLat: null,
        courierLng: null,
        branchName: null,
      });
    }
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
            courier_latitude: position.coords.latitude,
            courier_longitude: position.coords.longitude,
          }),
        }, token);
        setStatus(
          nextStatus === 'DELIVERED'
            ? 'Entrega marcada como completada.'
            : 'Ubicación compartida. El cliente ya puede verla.'
        );
        loadRoute();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'No se pudo actualizar la entrega');
      }
    }, () => setStatus('Debes permitir la ubicación para iniciar la entrega'));
  }

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
            {/* Mostrar mapa Leaflet con origen, destino y reparto */}
            <DeliveryMap
              originLat={mapData.originLat}
              originLng={mapData.originLng}
              destinationLat={mapData.destinationLat}
              destinationLng={mapData.destinationLng}
              courierLat={mapData.courierLat}
              courierLng={mapData.courierLng}
              branchName={mapData.branchName}
            />
            {/* Enlace externo a Google Maps */}
            {useGoogleMapLink(selectedOrder.address, selectedOrder.branch?.name)}
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