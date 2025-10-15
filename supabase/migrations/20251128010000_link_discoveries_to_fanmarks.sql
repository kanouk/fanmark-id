-- Link fanmark discoveries/favorites to newly created fanmarks

CREATE OR REPLACE FUNCTION public.link_fanmark_discovery(new_fanmark_id uuid, normalized_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  linked_discovery_id uuid;
BEGIN
  IF new_fanmark_id IS NULL OR normalized_ids IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.fanmark_discoveries
  SET fanmark_id = new_fanmark_id,
      availability_status = 'owned_by_user'
  WHERE seq_key(normalized_emoji_ids) = seq_key(normalized_ids)
  RETURNING id INTO linked_discovery_id;

  IF linked_discovery_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.fanmark_favorites
  SET fanmark_id = new_fanmark_id
  WHERE discovery_id = linked_discovery_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_fanmark_discovery_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  PERFORM public.link_fanmark_discovery(NEW.id, NEW.normalized_emoji_ids);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_link_fanmark_discovery ON public.fanmarks;

CREATE TRIGGER trg_link_fanmark_discovery
AFTER INSERT ON public.fanmarks
FOR EACH ROW
EXECUTE FUNCTION public.link_fanmark_discovery_trigger();

-- Backfill existing fanmarks
SELECT public.link_fanmark_discovery(f.id, f.normalized_emoji_ids)
FROM public.fanmarks f;
