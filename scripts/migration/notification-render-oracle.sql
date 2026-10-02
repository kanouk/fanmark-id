BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
WITH RECURSIVE cases(label,payload,template) AS (VALUES ('literal_dollars','{"fanmark_name":"$& $$ $` $''"}'::jsonb,'前 {{fanmark_name}} 後'),
('nested_jsonb','{"details":{"long":"value","a":true,"bb":[null,2,{"z":"🌸","a":"quote\""}]}}'::jsonb,'{{details}}'),
('key_order_cascade','{"zz":"VALUE","a":"{{zz}}"}'::jsonb,'{{a}}'),
('unicode_key_order','{"é":"{{z}}","z":"短","aa":"{{é}}"}'::jsonb,'{{aa}}'),
('numeric_notation','{"number":1e-7,"huge":1e+21,"neg":-1e-7,"negative_zero":0}'::jsonb,'{{number}}|{{huge}}|{{neg}}|{{negative_zero}}'),
('null_boolean_array','{"nullable":null,"boolean":false,"array":[null,true,1e-7]}'::jsonb,'{{nullable}}|{{boolean}}|{{array}}'),
('date_placeholders','{"grace_expires_at":"2026-10-03","license_end":"2026-10-03","expires_at":"2026-10-03","created_at":"2026-10-03","updated_at":"2026-10-03","name":"合成"}'::jsonb,'{{grace_expires_at}}|{{license_end}}|{{expires_at}}|{{created_at}}|{{updated_at}}|{{name}}')),
keys AS (SELECT c.label,k.key_name,k.ord::integer AS ordinal
 FROM cases c CROSS JOIN LATERAL jsonb_object_keys(c.payload) WITH ORDINALITY AS k(key_name,ord)),
rendered(label,payload,ordinal,body) AS (
 SELECT label,payload,0,template FROM cases
 UNION ALL
 SELECT r.label,r.payload,k.ordinal,
 CASE WHEN k.key_name = ANY(ARRAY['grace_expires_at','license_end','expires_at','created_at','updated_at'])
 OR r.payload->>k.key_name IS NULL THEN r.body
 ELSE replace(r.body,'{{'||k.key_name||'}}',r.payload->>k.key_name) END
 FROM rendered r JOIN keys k ON k.label=r.label AND k.ordinal=r.ordinal+1)
SELECT jsonb_build_object('observed_at',clock_timestamp(),
 'cases',(SELECT jsonb_agg(jsonb_build_object('label',c.label,'payload',c.payload,'template',c.template,
 'expected',r.body,'keyOrder',(SELECT jsonb_agg(key_name ORDER BY ordinal) FROM keys WHERE label=c.label)) ORDER BY c.label)
 FROM cases c JOIN rendered r ON r.label=c.label AND r.ordinal=(SELECT count(*) FROM keys WHERE label=c.label))) AS oracle;
COMMIT;