
export interface OpenEhrComposition {
  _type: "COMPOSITION";
  name: {
    _type: "DV_TEXT";
    value: string;
  };
  archetype_details: {
    archetype_id: {
      value: string;
    };
    template_id: {
      value: string;
    };
    rm_version: string;
  };
  archetype_node_id: string;
  uid?: {
    _type: "OBJECT_VERSION_ID";
    value: string;
  };
}