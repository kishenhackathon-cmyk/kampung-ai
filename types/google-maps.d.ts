/// <reference types="@types/google.maps" />

declare namespace google.maps {
  export interface PlacesLibrary {
    PlacesService: typeof google.maps.places.PlacesService;
    SearchBox: typeof google.maps.places.SearchBox;
  }

  export interface MapsLibrary {
    Map: typeof google.maps.Map;
  }

  export interface MarkerLibrary {
    AdvancedMarkerElement: any;
    Marker: typeof google.maps.Marker;
  }
}

declare global {
  interface Window {
    google: typeof google;
  }
}

export {};