import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiRequest, uploadPrescription } from '../../api';
import { money } from '../../lib/catalog';

function RouteMap({ origin, destination }: { origin: string; destination: string }) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const [mapStatus, setMapStatus] = useState('Calculando ruta...');
  useEffect(() => {
    let map: L.Map | null = null; let cancelled = false;
    async function loadMap() {
      try {
        const geocode = async (address: string) => {
          const cleanedAddress = address.replace(/\s+/g, ' ').trim();
          const withoutHouseNumber = cleanedAddress.replace(/,?\s*(casa|casa no\.?|#)\s*[^,]+/i, '').replace(/,\s*$/, '').trim();
          const municipalityMatch = cleanedAddress.match(/(Jocotenango|Antigua Guatemala|Ciudad Vieja|Pastores|San Lucas Sacatepequez|Santa Maria de Jesus)/i);
          const municipality = municipalityMatch?.[1] ?? 'Sacatepequez'; const street = withoutHouseNumber.split(',')[0].trim();
          const queries = Array.from(new Set([`${cleanedAddress}, Sacatepequez, Guatemala`, `${withoutHouseNumber}, ${municipality}, Sacatepequez, Guatemala`, `${street}, ${municipality}, Sacatepequez, Guatemala`, `${municipality}, Sacatepequez, Guatemala`].filter(Boolean)));
          for (const query of queries) { const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gt&q=${encodeURIComponent(query)}`); if (!response.ok) continue; const results = await response.json() as Array<{ lat: string; lon: string }>; if (results[0]) return { lat: Number(results[0].lat), lon: Number(results[0].lon), approximate: query !== queries[0] }; }
          throw new Error(`No se encontró una ubicación para: ${address}`);
        };
        const [start, end] = await Promise.all([geocode(`${origin}, Sacatepéquez, Guatemala`), geocode(`${destination}, Sacatepéquez, Guatemala`)]);
        if (cancelled || !mapElement.current) return;
        map = L.map(mapElement.current).setView([end.lat, end.lon], 13); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
        L.circleMarker([start.lat, start.lon], { radius: 8, color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 1 }).addTo(map).bindPopup('Sucursal de salida'); L.circleMarker([end.lat, end.lon], { radius: 8, color: '#b91c1c', fillColor: '#ef4444', fillOpacity: 1 }).addTo(map).bindPopup(end.approximate ? 'Ubicación aproximada de entrega' : 'Dirección de entrega');
        const routeResponse = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`); if (!routeResponse.ok) throw new Error('No se pudo calcular la ruta'); const routeData = await routeResponse.json() as { routes?: Array<{ geometry: { coordinates: [number, number][] } }> }; const coordinates = routeData.routes?.[0]?.geometry.coordinates; if (!coordinates?.length) throw new Error('No se encontró una ruta para la dirección'); const line = L.polyline(coordinates.map(([lon, lat]) => [lat, lon] as [number, number]), { color: '#2563eb', weight: 5 }).addTo(map); map.fitBounds(line.getBounds(), { padding: [24, 24] }); setMapStatus(start.approximate || end.approximate ? 'Ruta aproximada calculada. El número de casa no está registrado en el mapa.' : 'Ruta calculada dentro de la aplicación');
      } catch (error) { if (!cancelled) setMapStatus(error instanceof Error ? error.message : 'No se pudo cargar la ruta'); }
    }
    loadMap(); return () => { cancelled = true; map?.remove(); };
  }, [origin, destination]);
  return <div><div ref={mapElement} style={{ width: '100%', height: '360px', borderRadius: '8px', overflow: 'hidden', marginTop: '0.75rem' }} /><p className="checkout-status-msg" style={{ marginTop: '0.5rem' }}>{mapStatus}</p></div>;
}

export function DeliveryPage({ token }: { token: string | null }) {
  const [orders, setOrders] = useState<any[]>([]); const [selectedOrder, setSelectedOrder] = useState<any | null>(null); const [status, setStatus] = useState(''); const [recipe, setRecipe] = useState<File | null>(null); const [orderId, setOrderId] = useState('');
  async function loadRoute() { if (!token) return; const data = await apiRequest<any[]>(`/api/pos/deliveries?branchId=1`, {}, token); setOrders(data); }
  useEffect(() => { loadRoute().catch((error) => setStatus(error.message)); }, [token]);
  async function uploadProof() { try { if (!recipe) throw new Error('Selecciona la foto de la receta entregada'); const result = await uploadPrescription(recipe, Number(orderId), 'delivery', token); setStatus(`Evidencia subida correctamente: ${result.url}`); loadRoute(); } catch (error) { setStatus(error instanceof Error ? error.message : 'Error al subir evidencia'); } }
  async function updateDeliveryLocation(id: number, nextStatus = 'IN_ROUTE') { if (!token || !navigator.geolocation) { setStatus('Este dispositivo no permite compartir ubicación'); return; } navigator.geolocation.getCurrentPosition(async (position) => { try { await apiRequest(`/api/pos/deliveries/${id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus, latitude: position.coords.latitude, longitude: position.coords.longitude }) }, token); setStatus(nextStatus === 'DELIVERED' ? 'Entrega marcada como completada.' : 'Ubicación compartida. El cliente ya puede verla.'); await loadRoute(); } catch (error) { setStatus(error instanceof Error ? error.message : 'No se pudo actualizar la entrega'); } }, () => setStatus('Debes permitir la ubicación para iniciar la entrega')); }
  return <div className="internal-page-container"><div className="two-col-grid"><div className="panel-card"><div className="panel-head"><h2>Hoja de Ruta de Reparto</h2><span className="pill-tag">{orders.length} entregas</span></div><div className="item-list-stack">{orders.map((order, idx) => <button key={order.id} type="button" className="route-row" onClick={() => setSelectedOrder(order)} style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer' }}><div className="route-num">{idx + 1}</div><div><strong>{order.code}</strong><p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{order.customer?.name ?? 'Cliente'} · {order.branch?.name}</p><small>{order.address || 'Sin dirección registrada'}</small><small>{money(order.total)} · {order.status}</small><div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }} onClick={(event) => event.stopPropagation()}><button type="button" className="btn-secondary" onClick={() => updateDeliveryLocation(order.id)}>Iniciar / actualizar ruta</button><button type="button" className="btn-secondary" onClick={() => updateDeliveryLocation(order.id, 'DELIVERED')}>Marcar entregado</button></div></div></button>)}</div></div>
    {selectedOrder && <div className="panel-card"><div className="panel-head"><h2>Ruta de entrega {selectedOrder.code}</h2><button type="button" className="btn-secondary" onClick={() => setSelectedOrder(null)}>Cerrar</button></div><p><strong>Sale de:</strong> {selectedOrder.branch?.name ?? 'Sucursal asignada'}</p><p><strong>Dirección:</strong> {selectedOrder.address || 'No registrada'}</p>{selectedOrder.address ? <RouteMap origin={selectedOrder.branch?.address || selectedOrder.branch?.name || 'Sacatepéquez'} destination={selectedOrder.address} /> : <p className="checkout-status-msg">Esta orden no tiene una dirección de entrega.</p>}</div>}
    <div className="panel-card"><div className="panel-head"><h2>Evidencia de Entrega</h2><span className="pill-tag">Cargar Receta</span></div><div className="form-field"><label>ID de Orden</label><input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Ej. 1" /></div><div className="form-field"><label>Foto de la Receta Firmada</label><label className="prescription-dropzone"><span>Imagen</span><span>{recipe ? recipe.name : 'Tomar foto o elegir imagen...'}</span><input type="file" accept="image/*" onChange={(e) => setRecipe(e.target.files?.[0] ?? null)} /></label></div><button type="button" className="btn-primary" onClick={uploadProof}>Cargar y Validar Entrega</button>{status && <div className="checkout-status-msg">{status}</div>}</div>
  </div></div>;
}

export default DeliveryPage;
