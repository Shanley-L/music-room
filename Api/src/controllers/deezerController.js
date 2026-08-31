export async function discover(req, res) {
  try {
    let url = 'https://api.deezer.com/chart';

    const response = await fetch(url);

    if (!response.ok) {
      return res.status(500).json({
        error: 'Erreur Deezer',
        results: [],
      });
    }

    const data = await response.json();

    return res.status(200).json({
      response: data
    });

  } catch (err) {
    return res.status(400).json({
      error: err
    });
  }
}

export async function search(req, res) {
  try {
    const query = req.query.q || '';

    if (!query.trim()) {
      return res.status(200).json({
        query: '',
        results: [],
      });
    }

    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(500).json({
        error: 'Erreur Deezer',
        results: [],
      });
    }

    const data = await response.json();

    return res.status(200).json({
      query,
      results: data.data || [],
      total: data.total || 0,
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'Erreur interne',
      results: [],
    });
  }
}

