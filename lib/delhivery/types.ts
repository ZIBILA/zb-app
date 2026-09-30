export interface DelhiveryOrder {
  shopifyOrderId: string;
  paymentMode: 'Prepaid' | 'COD';
  total: number;
  quantity: number;
  weight: number;
  shipment_length?: number;
  shipment_width?: number;
  shipment_height?: number;
  shipping_mode?: 'Surface' | 'Express';
  sellerInvoice?: string;
  shippingAddress: {
    name: string;
    add: string;
    pin: string;
    city: string;
    state: string;
    phone: string;
  };
  items: Array<{
    title: string;
  }>;
}

export interface DelhiveryTrackingResponse {
  ShipmentData?: Array<{
    Shipment: {
      AWB: string;
      ReferenceNo?: string;
      ExpectedDeliveryDate?: string;
      Status: {
        Status: string;
        StatusDateTime: string;
        StatusType: string;
        StatusLocation: string;
        Instructions?: string;
      };
      Scans?: Array<{
        ScanDetail: {
          Scan: string;
          ScannedLocation: string;
          ScanDateTime: string;
          Instructions?: string;
        };
      }>;
    };
  }>;
}
