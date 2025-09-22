-- Delete old fanmark records without license information
DELETE FROM fanmarks 
WHERE current_license_id IS NULL;