<?php
/**
 * Comandi WP-CLI.
 *
 * @package CignoZen\SutraStudio
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

/**
 * Gestione dello Studio dei Sutra.
 */
class CZSS_CLI_Command
{
    /**
     * Importa i sutra dal vecchio plugin cz-sutra-memorizer (data/sutras.json).
     *
     * Gli audio vengono caricati nella Libreria Media. I sutra già presenti
     * (stesso slug) vengono saltati, a meno di --update.
     *
     * ## OPTIONS
     *
     * [--file=<path>]
     * : File JSON. Default: plugins/cz-sutra-memorizer/data/sutras.json
     *
     * [--update]
     * : Aggiorna testi e schede dei sutra già importati.
     *
     * [--status=<status>]
     * : Stato dei nuovi sutra.
     * ---
     * default: publish
     * ---
     *
     * ## EXAMPLES
     *
     *     wp cz-sutra-studio import
     *
     * @param array<int, string>    $args
     * @param array<string, string> $assoc
     */
    public function import(array $args, array $assoc): void
    {
        $file = $assoc['file'] ?? WP_PLUGIN_DIR . '/cz-sutra-memorizer/data/sutras.json';
        if (! is_readable($file)) {
            WP_CLI::error("File non leggibile: {$file}");
        }

        $data = json_decode((string) file_get_contents($file), true);
        if (! is_array($data)) {
            WP_CLI::error('JSON non valido.');
        }

        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';

        $base_dir = dirname($file, 2);
        $order    = 0;

        foreach ($data as $sutra) {
            $order += 10;
            $slug = sanitize_title($sutra['id'] ?? '');
            if ('' === $slug) {
                continue;
            }

            $existing = get_posts([
                'post_type'      => CZSS_POST_TYPE,
                'name'           => $slug,
                'post_status'    => 'any',
                'posts_per_page' => 1,
            ]);

            if ($existing && ! isset($assoc['update'])) {
                WP_CLI::log("· {$slug}: già presente, salto.");
                continue;
            }

            $postarr = [
                'post_type'    => CZSS_POST_TYPE,
                'post_title'   => (string) ($sutra['title']['romaji'] ?? $slug),
                'post_name'    => $slug,
                'post_content' => (string) ($sutra['description'] ?? ''),
                'post_status'  => $assoc['status'] ?? 'publish',
                'menu_order'   => $order,
            ];

            if ($existing) {
                $postarr['ID'] = $existing[0]->ID;
                unset($postarr['post_status'], $postarr['menu_order']);
                $post_id = wp_update_post(wp_slash($postarr), true);
            } else {
                $post_id = wp_insert_post(wp_slash($postarr), true);
            }

            if (is_wp_error($post_id)) {
                WP_CLI::warning("{$slug}: " . $post_id->get_error_message());
                continue;
            }

            update_post_meta($post_id, CZSS_META_KANJI, (string) ($sutra['title']['original'] ?? ''));
            update_post_meta($post_id, CZSS_META_TRANSL, (string) ($sutra['title']['translation'] ?? ''));

            $source_cards = is_array($sutra['cards'] ?? null) ? $sutra['cards'] : [];
            usort($source_cards, static fn ($a, $b) => (int) ($a['sequence'] ?? 0) <=> (int) ($b['sequence'] ?? 0));

            $cards = array_map(static fn ($c) => [
                'id'          => (string) ($c['id'] ?? ''),
                'original'    => $c['original'] ?? '',
                'romaji'      => $c['romaji'] ?? '',
                'translation' => $c['translation'] ?? '',
                'note'        => $c['note'] ?? '',
                'start'       => $c['audioStart'] ?? null,
                'end'         => $c['audioEnd'] ?? null,
            ], $source_cards);

            czss_save_cards($post_id, czss_sanitize_cards($cards));

            if (! get_post_meta($post_id, CZSS_META_AUDIO, true) && ! empty($sutra['audio'])) {
                $audio_path = $base_dir . '/' . ltrim((string) $sutra['audio'], '/');
                $attachment = $this->sideload($audio_path, $post_id, (string) $postarr['post_title']);
                if (is_wp_error($attachment)) {
                    WP_CLI::warning("{$slug}: audio non importato — " . $attachment->get_error_message());
                } else {
                    update_post_meta($post_id, CZSS_META_AUDIO, $attachment);
                }
            }

            WP_CLI::success(sprintf('%s: %d schede (post #%d)', $slug, count($cards), $post_id));
        }
    }

    /**
     * Copia un file audio locale nella Libreria Media.
     *
     * @return int|WP_Error
     */
    private function sideload(string $path, int $post_id, string $title)
    {
        if (! is_readable($path)) {
            return new WP_Error('czss_missing', "file mancante: {$path}");
        }

        $tmp = wp_tempnam(basename($path));
        if (! $tmp || ! copy($path, $tmp)) {
            return new WP_Error('czss_copy', 'copia temporanea fallita');
        }

        $id = media_handle_sideload(['name' => basename($path), 'tmp_name' => $tmp], $post_id, $title);
        if (is_wp_error($id)) {
            @unlink($tmp); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
        }

        return $id;
    }

    /**
     * Elenca i sutra con il numero di schede e lo stato dei tempi.
     *
     * @param array<int, string>    $args
     * @param array<string, string> $assoc
     */
    public function list(array $args, array $assoc): void
    {
        $rows = array_map(static function (array $s): array {
            $timed = count(array_filter($s['cards'], static fn ($c) => null !== ($c['start'] ?? null)));
            return [
                'id'      => $s['postId'],
                'slug'    => $s['slug'],
                'title'   => $s['title'],
                'cards'   => count($s['cards']),
                'timed'   => $timed,
                'audio'   => $s['audio'] ? basename((string) $s['audio']['url']) : '-',
                'durata'  => $s['audio']['duration'] ?? '-',
            ];
        }, czss_get_all_sutras());

        WP_CLI\Utils\format_items('table', $rows, ['id', 'slug', 'title', 'cards', 'timed', 'audio', 'durata']);
    }
}

WP_CLI::add_command('cz-sutra-studio', 'CZSS_CLI_Command');
