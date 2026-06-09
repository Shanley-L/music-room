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
