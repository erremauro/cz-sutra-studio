<?php
/**
 * Custom Post Type "Sutra", tassonomia "Raccolta" ed endpoint REST.
 *
 * @package CignoZen\SutraStudio
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

function czss_register_post_type(): void
{
    register_post_type(CZSS_POST_TYPE, [
        'labels' => [
            'name'               => __('Sutra', 'cz-sutra-studio'),
            'singular_name'      => __('Sutra', 'cz-sutra-studio'),
            'menu_name'          => __('Studio dei Sutra', 'cz-sutra-studio'),
            'all_items'          => __('Tutti i sutra', 'cz-sutra-studio'),
            'add_new'            => __('Aggiungi sutra', 'cz-sutra-studio'),
            'add_new_item'       => __('Nuovo sutra', 'cz-sutra-studio'),
            'edit_item'          => __('Modifica sutra', 'cz-sutra-studio'),
            'new_item'           => __('Nuovo sutra', 'cz-sutra-studio'),
            'view_item'          => __('Vedi sutra', 'cz-sutra-studio'),
            'search_items'       => __('Cerca sutra', 'cz-sutra-studio'),
            'not_found'          => __('Nessun sutra trovato', 'cz-sutra-studio'),
            'not_found_in_trash' => __('Nessun sutra nel cestino', 'cz-sutra-studio'),
        ],
        'public'              => false,
        'show_ui'             => true,
        'show_in_menu'        => true,
        'show_in_rest'        => false,
        'menu_position'       => 21,
        'menu_icon'           => 'dashicons-book-alt',
        'hierarchical'        => false,
        'supports'            => ['title', 'editor', 'page-attributes', 'revisions'],
        'capability_type'     => 'post',
        'map_meta_cap'        => true,
        'rewrite'             => false,
        'query_var'           => false,
        'exclude_from_search' => true,
    ]);

    register_taxonomy(CZSS_TAXONOMY, CZSS_POST_TYPE, [
        'labels' => [
            'name'          => __('Raccolte', 'cz-sutra-studio'),
            'singular_name' => __('Raccolta', 'cz-sutra-studio'),
            'add_new_item'  => __('Nuova raccolta', 'cz-sutra-studio'),
            'edit_item'     => __('Modifica raccolta', 'cz-sutra-studio'),
            'search_items'  => __('Cerca raccolte', 'cz-sutra-studio'),
            'all_items'     => __('Tutte le raccolte', 'cz-sutra-studio'),
        ],
        'public'            => false,
        'show_ui'           => true,
        'show_admin_column' => true,
        'show_in_rest'      => false,
        'hierarchical'      => true,
        'rewrite'           => false,
    ]);
}
add_action('init', 'czss_register_post_type');

/**
 * Endpoint REST pubblico in sola lettura: /wp-json/cz-sutra-studio/v1/sutras
 */
add_action('rest_api_init', static function (): void {
    register_rest_route('cz-sutra-studio/v1', '/sutras', [
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => static fn () => rest_ensure_response(czss_get_all_sutras()),
    ]);
});

/**
 * Svuota le cache di pagina quando cambia un sutra, così l'app mostra subito i dati nuovi.
 */
function czss_flush_page_cache(int $post_id): void
{
    if (CZSS_POST_TYPE !== get_post_type($post_id) || wp_is_post_revision($post_id)) {
        return;
    }

    $page_ids = get_posts([
        'post_type'      => 'page',
        'post_status'    => ['publish', 'private', 'draft'],
        'posts_per_page' => 20,
        'fields'         => 'ids',
        's'              => '[cz-sutra-studio',
    ]);

    $page = get_page_by_path('utilita/studio-dei-sutra');
    if ($page) {
        $page_ids[] = $page->ID;
    }

    foreach (array_unique($page_ids) as $page_id) {
        clean_post_cache((int) $page_id);
        if (function_exists('w3tc_flush_post')) {
            w3tc_flush_post((int) $page_id);
        }
    }
}
add_action('save_post_' . CZSS_POST_TYPE, 'czss_flush_page_cache', 20);
add_action('trashed_post', 'czss_flush_page_cache');
add_action('untrashed_post', 'czss_flush_page_cache');
